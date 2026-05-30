// Stage 3: produce thumbnail/web/full sized JPEGs from the compressed source.
//
// Widths come from env.VARIANT_WIDTHS (three values, in thumbnail/web/full
// order). Resize is width-only with aspect preserved and withoutEnlargement
// so small inputs don't get upscaled into mush.
//
// The variant info object stored on Image.variants is { key, width, height,
// bytes } per variant - no presigned URLs at rest because they'd expire.
// image-dto signs them on read.

import { PipelineStage } from "@argon/shared";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../lib/logger.js";
import {
  downloadObjectToBuffer,
  s3Keys,
  uploadBuffer,
  VARIANT_NAMES,
} from "../../lib/s3.js";
import { toImageDto } from "../../lib/image-dto.js";
import { wsEmit } from "../../ws/emitter.js";

// One row stored on Image.variants per generated size. Width/height are post-
// resize values (after withoutEnlargement may have left the source untouched).
export interface StoredVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
}
export type StoredVariantSet = Record<(typeof VARIANT_NAMES)[number], StoredVariant>;

export async function handleVariants(imageId: string): Promise<void> {
  const image = await prisma.image.findUnique({ where: { id: imageId } });
  if (!image) {
    logger.warn("variants: image not found, skipping", { imageId });
    return;
  }

  if (image.pipelineStage === PipelineStage.Complete) {
    logger.info("variants: already complete, skipping", { imageId });
    return;
  }

  // The compress stage should have produced this. If it's missing the image
  // shouldn't be on this stream - log loudly and fail.
  if (!image.s3KeyCompressed) {
    const reason = "Variants stage reached without a compressed source";
    logger.error("variants: missing compressed key", { imageId });
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: { pipelineStage: PipelineStage.Failed, pipelineError: reason },
    });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
    return;
  }

  try {
    const sourceBuffer = await downloadObjectToBuffer(image.s3KeyCompressed);

    // Resize three sizes in parallel. Each is independent; sharp releases the
    // GIL-equivalent so libuv can run them concurrently on the threadpool.
    const widths = env.VARIANT_WIDTHS;
    const results = await Promise.all(
      VARIANT_NAMES.map(async (name, i) => {
        const width = widths[i];
        if (width === undefined) throw new Error(`Missing width for variant ${name}`);
        const out = await sharp(sourceBuffer)
          .resize({ width, withoutEnlargement: true })
          .jpeg({ quality: env.VARIANT_JPEG_QUALITY })
          .toBuffer({ resolveWithObject: true });
        const key = s3Keys.variant(imageId, name);
        await uploadBuffer(key, out.data, "image/jpeg");
        return [name, {
          key,
          width: out.info.width,
          height: out.info.height,
          bytes: out.data.length,
        }] as const;
      }),
    );

    const variants = Object.fromEntries(results) as StoredVariantSet;

    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.Complete,
        pipelineError: null,
        completedAt: new Date(),
        variants: variants as unknown as object,
      },
    });

    wsEmit.imageStatus({ image: await toImageDto(updated) });
    logger.info("variants: done", { imageId });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("variants: failed", { imageId, error: reason });
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        pipelineStage: PipelineStage.Failed,
        pipelineError: `Variants: ${reason}`.slice(0, 500),
      },
    });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
  }
}
