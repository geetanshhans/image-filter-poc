// Stage 1: normalize images to a consistent format (JPEG).
//
// For HEIC inputs: download original, decode HEIC -> JPEG, upload to the
// processed key. The validation worker may have already written this object
// (it converts HEIC for blur/face checks). That's fine - S3 PutObject is
// overwrite-idempotent and the bytes are deterministic.
//
// For JPEG/PNG inputs: no transform. The original is already a format
// downstream stages can work with.
//
// Idempotency: if pipelineStage is past CONVERTING, ack and skip. A reprocess
// or reconciler re-enqueue won't redo work or write duplicate variants.

import { PipelineStage } from "@argon/shared";
import { prisma } from "../../db/prisma.js";
import { convertHeicToJpeg, isHeicMime } from "../../lib/heic.js";
import { logger } from "../../lib/logger.js";
import {
  downloadObjectToBuffer,
  s3Keys,
  uploadBuffer,
} from "../../lib/s3.js";
import { toImageDto } from "../../lib/image-dto.js";
import { enqueueCompress } from "../../queue/producer.js";
import { wsEmit } from "../../ws/emitter.js";

// Stages that have already moved past CONVERTING. A re-delivered or replayed
// message for one of these should ack and skip.
const PAST_CONVERTING: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.Compressing,
  PipelineStage.GeneratingVariants,
  PipelineStage.Complete,
]);

export async function handleConvert(imageId: string): Promise<void> {
  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    logger.warn("convert: image not found, skipping", { imageId });
    return;
  }

  // Idempotency guard.
  if (image.pipelineStage && PAST_CONVERTING.has(image.pipelineStage as PipelineStage)) {
    logger.info("convert: already past stage, skipping", {
      imageId, stage: image.pipelineStage,
    });
    // Re-enqueue the next stage in case this delivery came from a reconciler
    // sweep where the next stream had no pending entry. The next handler's
    // own idempotency guard makes a duplicate harmless.
    if (image.pipelineStage === PipelineStage.Compressing) {
      await enqueueCompress({ imageId });
    }
    return;
  }

  try {
    if (isHeicMime(image.mimeType)) {
      // Only do the conversion if the processed key hasn't been written.
      // Re-encoding HEIC is the slow part; skipping when we can saves work
      // on reprocess + reduces churn on S3.
      if (!image.s3KeyProcessed) {
        const buffer = await downloadObjectToBuffer(image.s3KeyOriginal);
        const converted = await convertHeicToJpeg(buffer);
        const s3KeyProcessed = s3Keys.processed(imageId, converted.extension);
        await uploadBuffer(s3KeyProcessed, converted.buffer, converted.mimeType);
        await prisma.image.update({
          where: { id: imageId },
          data: { s3KeyProcessed },
        });
      }
    }
    // For non-HEIC inputs, nothing to do. The downstream stage reads from
    // s3KeyProcessed ?? s3KeyOriginal so a missing processed key is fine.

    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.Compressing,
        pipelineError: null,
        convertedAt: new Date(),
      },
    });

    await enqueueCompress({ imageId });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
    logger.info("convert: done", { imageId });
  } catch (err) {
    // Treat decode errors as terminal for this stage. The harness only retries
    // when we throw - here we mark FAILED so the user gets a clear reason and
    // the message acks cleanly.
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("convert: failed", { imageId, error: reason });
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.Failed,
        pipelineError: `Convert: ${reason}`.slice(0, 500),
      },
    });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
  }
}
