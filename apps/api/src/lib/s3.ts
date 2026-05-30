// Thin wrapper around the S3 client. Everything S3-related goes through here so
// the rest of the codebase doesn't have to care about presigners, bucket names,
// or the AWS SDK's quirks.

import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
  // When S3_ENDPOINT is set (e.g. MinIO for local dev), point the client there.
  // forcePathStyle is required by MinIO - it doesn't support virtual-hosted buckets.
  ...(env.S3_ENDPOINT
    ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true }
    : {}),
});

// All S3 keys live under one prefix so the bucket can be shared with other apps
// and so we can wipe-test-data with a single prefixed delete.
const KEY_PREFIX = "argon/uploads";

// Build keys in one place. Paths show the image id so the same image's original
// and processed variants are colocated in the bucket listing.
// Variant names produced by the variants stage. Order matters: it must align
// with env.VARIANT_WIDTHS (thumbnail, web, full).
export const VARIANT_NAMES = ["thumbnail", "web", "full"] as const;
export type VariantName = (typeof VARIANT_NAMES)[number];

export const s3Keys = {
  original(imageId: string, extension: string): string {
    return `${KEY_PREFIX}/${imageId}/original.${extension.toLowerCase()}`;
  },
  processed(imageId: string, extension: string): string {
    return `${KEY_PREFIX}/${imageId}/processed.${extension.toLowerCase()}`;
  },
  // Output of the compress stage. Always JPEG, so no extension parameter.
  compressed(imageId: string): string {
    return `${KEY_PREFIX}/${imageId}/compressed.jpg`;
  },
  // One key per variant size. Kept under a /variants/ folder for clarity in the
  // bucket listing and easy lifecycle-rule targeting later.
  variant(imageId: string, name: VariantName): string {
    return `${KEY_PREFIX}/${imageId}/variants/${name}.jpg`;
  },
};

// Issue a presigned PUT URL the browser uses to upload directly to S3.
// Setting ContentType binds the URL to a specific mime type; the browser must
// send the same Content-Type header on its PUT or S3 rejects the request.
export async function presignPutUrl(
  s3Key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: s3Key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS });
}

// Presigned GET URL used by the frontend to render previews.
export async function presignGetUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key });
  return getSignedUrl(s3, command, { expiresIn: env.S3_PRESIGN_EXPIRES_SECONDS });
}

// Read an object's bytes into a Buffer. Used by the worker to download
// images for validation. Streams are buffered in full because sharp and
// face-api both want a Buffer, not a stream.
export async function downloadObjectToBuffer(s3Key: string): Promise<Buffer> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }),
  );
  if (!result.Body) {
    throw new Error(`S3 object has no body: ${s3Key}`);
  }
  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

// Used after HEIC -> JPEG conversion to write the converted bytes back.
export async function uploadBuffer(
  s3Key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(s3Key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: s3Key }));
}

// Best-effort delete. We use this when the user removes an image — if the
// object is already gone we don't want the API call to fail.
export async function deleteObjectIfExists(s3Key: string): Promise<void> {
  try {
    await deleteObject(s3Key);
  } catch (err) {
    // Swallow the error. The DB row gets deleted regardless; orphaned S3 objects
    // can be cleaned up with a lifecycle rule later.
    console.warn(`Failed to delete S3 object ${s3Key}:`, err);
  }
}
