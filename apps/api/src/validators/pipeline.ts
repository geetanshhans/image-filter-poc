// Composes all validators into a single pipeline that short-circuits on the
// first failure. The order matters: cheap checks first, expensive ones last,
// so we don't run face detection on something we'd reject for being 100x100
// pixels.
//
// Pipeline order:
//   1. size            (cheap - just looks at numbers)
//   2. blur            (medium - one sharp resize + convolve)
//   3. face            (expensive - runs the SSD MobileNet detector)
//   4. similarity      (expensive too - DCT + DB scan)
//
// The runner also handles the HEIC -> JPEG conversion before validation,
// since face-api can't decode HEIC and similarity hashing wants the same
// format we'll later display.

import sharp from "sharp";
import { logger } from "../lib/logger.js";
import { convertHeicToJpeg, isHeicMime } from "../lib/heic.js";
import { blurValidator } from "./blur.js";
import { faceValidator } from "./face.js";
import { similarityValidator, type ContextWithPHash } from "./similarity.js";
import { sizeValidator } from "./size.js";
import type { ValidationContext, ValidationResult, Validator } from "./types.js";

const PIPELINE: Validator[] = [
  sizeValidator,
  blurValidator,
  faceValidator,
  similarityValidator,
];

export interface PipelineInput {
  imageId: string;
  // The bytes as they exist in S3 right now.
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
}

export interface PipelineOutput {
  result: ValidationResult;
  // If we ran HEIC conversion, callers need the JPEG bytes to upload them
  // back to S3 as the "processed" key.
  processed?: {
    buffer: Buffer;
    mimeType: "image/jpeg";
    extension: "jpg";
  };
  // pHash gets persisted on accepted images so future similarity checks find them.
  pHash?: string;
  width: number;
  height: number;
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  // Step 1 - convert HEIC up front. Everything downstream then deals with JPEG.
  let buffer = input.buffer;
  let mimeType = input.mimeType;
  let processed: PipelineOutput["processed"];
  if (isHeicMime(input.mimeType)) {
    const converted = await convertHeicToJpeg(input.buffer);
    buffer = converted.buffer;
    mimeType = converted.mimeType;
    processed = converted;
    logger.debug("Converted HEIC to JPEG", { imageId: input.imageId });
  }

  // Step 2 - extract dimensions. sharp's metadata is fast and reliable for
  // anything sharp can decode, which after HEIC conversion is everything.
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const ctx: ValidationContext = {
    imageId: input.imageId,
    buffer,
    mimeType,
    width,
    height,
    originalSizeBytes: input.sizeBytes,
    originalMimeType: input.mimeType,
  };

  // Step 3 - run validators in order, stopping at the first rejection.
  for (const validator of PIPELINE) {
    const result = await validator.run(ctx);
    if (!result.ok) {
      logger.info("Validation rejected", {
        imageId: input.imageId,
        validator: validator.name,
        reason: result.reason,
        detail: result.detail,
      });
      return {
        result,
        processed,
        // Include the pHash if the similarity validator computed one before
        // rejecting (it doesn't on this path, but other validators don't set it
        // and that's fine).
        pHash: (ctx as ContextWithPHash).pHash,
        width,
        height,
      };
    }
  }

  return {
    result: { ok: true },
    processed,
    pHash: (ctx as ContextWithPHash).pHash,
    width,
    height,
  };
}
