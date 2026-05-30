// Stage 2: re-encode to JPEG at a lower quality to reduce file size.
//
// Source = the converted JPEG (s3KeyProcessed) if present, otherwise the
// original. Output is always a single JPEG at s3Keys.compressed(imageId).
//
// We track compressedBytes and compressionRatio (compressed / original) so the
// UI and load test can show the savings.

import { PipelineStage } from "@argon/shared";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../lib/logger.js";
import {
  downloadObjectToBuffer,
  s3Keys,
  uploadBuffer,
} from "../../lib/s3.js";
import { toImageDto } from "../../lib/image-dto.js";
import { enqueueVariants } from "../../queue/producer.js";
import { wsEmit } from "../../ws/emitter.js";

const PAST_COMPRESSING: ReadonlySet<PipelineStage> = new Set([
  PipelineStage.GeneratingVariants,
  PipelineStage.Complete,
]);

export async function handleCompress(imageId: string): Promise<void> {
  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    logger.warn("compress: image not found, skipping", { imageId });
    return;
  }

  if (image.pipelineStage && PAST_COMPRESSING.has(image.pipelineStage as PipelineStage)) {
    logger.info("compress: already past stage, skipping", {
      imageId, stage: image.pipelineStage,
    });
    if (image.pipelineStage === PipelineStage.GeneratingVariants) {
      await enqueueVariants({ imageId });
    }
    return;
  }

  try {
    // Prefer the normalized JPEG when convert produced one. For native JPEG/PNG
    // inputs there's no processed key, so we read the original directly.
    const sourceKey = image.s3KeyProcessed ?? image.s3KeyOriginal;
    const sourceBuffer = await downloadObjectToBuffer(sourceKey);

    // mozjpeg trades CPU for ~5-10% smaller files at the same visual quality.
    // Worth it here because compress is rarely the bottleneck and bytes matter.
    const compressed = await sharp(sourceBuffer)
      .jpeg({ quality: env.COMPRESS_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const s3KeyCompressed = s3Keys.compressed(imageId);
    await uploadBuffer(s3KeyCompressed, compressed, "image/jpeg");

    const compressedBytes = compressed.length;
    const compressionRatio = compressedBytes / image.sizeBytes;

    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.GeneratingVariants,
        pipelineError: null,
        s3KeyCompressed,
        compressedBytes,
        compressionRatio,
        compressedAt: new Date(),
      },
    });

    await enqueueVariants({ imageId });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
    logger.info("compress: done", {
      imageId,
      ratio: compressionRatio.toFixed(3),
      origBytes: image.sizeBytes,
      newBytes: compressedBytes,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("compress: failed", { imageId, error: reason });
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.Failed,
        pipelineError: `Compress: ${reason}`.slice(0, 500),
      },
    });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
  }
}
