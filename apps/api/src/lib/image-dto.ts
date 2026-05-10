// Converts a Prisma Image row into the ImageDto the frontend consumes.
// Kept in one place so every endpoint serializes images identically.

import type { Image } from "@prisma/client";
import type {
  ImageDto,
  ImageStatus,
  RejectionReason,
} from "@argon/shared";
import { isHeicMime } from "./heic.js";
import { presignGetUrl } from "./s3.js";

// Returns the S3 key the browser should fetch for a preview, or null if no
// renderable image exists yet. The order matters:
//   1. If the worker wrote a processed JPEG (HEIC inputs only), prefer it.
//   2. Otherwise, JPG/PNG originals are fine - browsers render them directly.
//   3. HEIC originals without a processed key yet: return null. Browsers
//      can't render HEIC, so handing them the .heic URL would just produce
//      a broken-image icon. The grid card already handles null by showing
//      a grey placeholder + "Processing..." label.
function previewS3Key(image: Image): string | null {
  if (image.status === "PENDING_UPLOAD") return null;
  if (image.s3KeyProcessed) return image.s3KeyProcessed;
  if (!isHeicMime(image.mimeType)) return image.s3KeyOriginal;
  return null;
}

export async function toImageDto(image: Image): Promise<ImageDto> {
  const key = previewS3Key(image);
  const previewUrl = key ? await presignGetUrl(key) : null;
  return {
    id: image.id,
    originalName: image.originalName,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
    status: image.status as ImageStatus,
    rejectionReason: (image.rejectionReason as RejectionReason | null) ?? null,
    previewUrl,
    createdAt: image.createdAt.toISOString(),
  };
}

// Batch variant. Generating presigned URLs in parallel matters when listing
// dozens of images at once - serial signing adds up fast.
export async function toImageDtos(images: Image[]): Promise<ImageDto[]> {
  return Promise.all(images.map(toImageDto));
}
