// Upload-related endpoints. The flow is:
//
//   POST /api/uploads/batch       -> create DB rows + presigned PUT URLs
//   PUT  <presigned URL>          -> browser sends bytes to S3 directly
//   POST /api/uploads/:id/complete -> verify upload, enqueue validation
//
// The API never touches the file bytes during upload. That's the whole point
// of presigned URLs: it lets us handle hundreds of concurrent uploads without
// the API being a bottleneck.

import { Router } from "express";
import { z } from "zod";
import {
  ALLOWED_MIME_TYPES,
  ImageStatus,
  type BatchUploadResponse,
  type CompleteUploadResponse,
} from "@argon/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { httpErrors } from "../lib/errors.js";
import { resolveExtension } from "../lib/extension.js";
import { presignPutUrl, s3Keys } from "../lib/s3.js";
import { toImageDto } from "../lib/image-dto.js";
import { enqueueValidation } from "../queue/producer.js";
import { wsEmit } from "../ws/emitter.js";

export const uploadsRouter = Router();

// --- POST /api/uploads/batch ----------------------------------------------

const BatchItemSchema = z.object({
  originalName: z.string().min(1).max(512),
  // We accept any string here and check against ALLOWED_MIME_TYPES below.
  // Doing it this way means the error message names the offending file.
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

const BatchSchema = z.object({
  // Reasonable upper bound to keep one request from creating thousands of rows.
  files: z.array(BatchItemSchema).min(1).max(50),
});

uploadsRouter.post(
  "/batch",
  asyncHandler(async (req, res) => {
    const body = BatchSchema.parse(req.body);

    // Validate every file before creating any DB rows. If one is bad, the
    // whole batch fails - simpler than partial success.
    for (const [i, file] of body.files.entries()) {
      if (file.sizeBytes > env.MAX_FILE_SIZE_BYTES) {
        throw httpErrors.payloadTooLarge(
          "FILE_TOO_LARGE",
          `File at index ${i} ("${file.originalName}") exceeds max size of ${env.MAX_FILE_SIZE_BYTES} bytes`,
        );
      }
      const mimeOk = (ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType);
      const ext = resolveExtension(file.mimeType, file.originalName);
      if (!mimeOk && !ext) {
        throw httpErrors.unsupportedMediaType(
          "INVALID_FORMAT",
          `File at index ${i} ("${file.originalName}") has unsupported type "${file.mimeType}"`,
        );
      }
    }

    // Create DB rows and presign URLs in parallel. Each row is independent.
    const items = await Promise.all(
      body.files.map(async (file, index) => {
        const ext = resolveExtension(file.mimeType, file.originalName) ?? "bin";
        const image = await prisma.image.create({
          data: {
            originalName: file.originalName,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            // Temporary placeholder. We rewrite this with the real key right
            // after creation since we need the row's id to build the path.
            s3KeyOriginal: `pending-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            status: ImageStatus.PendingUpload,
          },
        });

        const s3Key = s3Keys.original(image.id, ext);
        const updated = await prisma.image.update({
          where: { id: image.id },
          data: { s3KeyOriginal: s3Key },
        });

        const uploadUrl = await presignPutUrl(s3Key, file.mimeType);

        // Notify any other open tabs that a new image was created.
        wsEmit.imageCreated({ image: await toImageDto(updated) });

        return { index, imageId: image.id, uploadUrl, s3Key };
      }),
    );

    const response: BatchUploadResponse = { items };
    res.status(201).json(response);
  }),
);

// --- POST /api/uploads/:id/complete --------------------------------------

uploadsRouter.post(
  "/:id/complete",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);

    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) throw httpErrors.notFound("IMAGE_NOT_FOUND", "Image not found");

    if (image.status !== ImageStatus.PendingUpload) {
      // Already completed - return the current state instead of erroring.
      // This makes the endpoint idempotent, which matters because the client
      // might retry on flaky networks.
      const response: CompleteUploadResponse = { image: await toImageDto(image) };
      res.json(response);
      return;
    }

    // Move to PROCESSING and enqueue. Setting status before enqueueing means
    // a refresh shows "Processing" right away even if the worker takes a moment.
    const updated = await prisma.image.update({
      where: { id },
      data: { status: ImageStatus.Processing },
    });

    await enqueueValidation({ imageId: id });

    const dto = await toImageDto(updated);
    wsEmit.imageStatus({ image: dto });

    const response: CompleteUploadResponse = { image: dto };
    res.json(response);
  }),
);
