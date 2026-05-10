// Pulls one image through the validation pipeline and writes the outcome
// back to the database + S3. Called by the worker loop for each stream entry.
//
// Outcomes:
//   - PASS: status = ACCEPTED, pHash saved, processed JPEG uploaded if HEIC.
//   - FAIL: status = REJECTED, rejectionReason + detail saved.
//   - THROW: caller decides whether to retry. We don't catch here because
//     a transient error (e.g. S3 blip) should be retried via XPENDING.

import { ImageStatus } from "@argon/shared";
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";
import {
  downloadObjectToBuffer,
  s3Keys,
  uploadBuffer,
} from "../lib/s3.js";
import { runPipeline } from "../validators/pipeline.js";
import { wsEmit } from "../ws/emitter.js";
import { toImageDto } from "../lib/image-dto.js";

export async function processImage(imageId: string): Promise<void> {
  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    // The user deleted the image before we got to it. Nothing to do.
    logger.warn("Worker: image not found, skipping", { imageId });
    return;
  }

  // Download bytes from S3.
  const buffer = await downloadObjectToBuffer(image.s3KeyOriginal);

  const { result, processed, pHash, width, height } = await runPipeline({
    imageId,
    buffer,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
  });

  // If we converted from HEIC, the processed JPEG goes to a sibling key
  // so previews can serve a browser-renderable file.
  let s3KeyProcessed: string | null = null;
  if (processed) {
    s3KeyProcessed = s3Keys.processed(imageId, processed.extension);
    await uploadBuffer(s3KeyProcessed, processed.buffer, processed.mimeType);
  }

  // Persist the outcome. We always store width/height now that we know them.
  const updated = await prisma.image.update({
    where: { id: imageId },
    data: {
      status: result.ok ? ImageStatus.Accepted : ImageStatus.Rejected,
      rejectionReason: result.ok ? null : result.reason,
      rejectionDetail: result.ok ? null : result.detail,
      width,
      height,
      // Store pHash so future similarity checks find this image.
      pHash: pHash ?? null,
      s3KeyProcessed,
    },
  });

  wsEmit.imageStatus({ image: await toImageDto(updated) });
  logger.info("Processed image", {
    imageId,
    status: updated.status,
    reason: updated.rejectionReason ?? undefined,
  });
}
