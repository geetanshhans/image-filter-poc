// Read and delete operations for images. Create happens in routes/uploads.ts
// because it's part of the upload flow rather than a generic resource create.

import { Router } from "express";
import { z } from "zod";
import {
  ImageStatus,
  type DeleteImageResponse,
  type GetImageResponse,
  type ListImagesResponse,
} from "@argon/shared";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { httpErrors } from "../lib/errors.js";
import { toImageDto, toImageDtos } from "../lib/image-dto.js";
import { deleteObjectIfExists } from "../lib/s3.js";
import { wsEmit } from "../ws/emitter.js";

export const imagesRouter = Router();

// --- GET /api/images ------------------------------------------------------

const ListQuerySchema = z.object({
  status: z.nativeEnum(ImageStatus).optional(),
  // Comma-separated UUIDs. Used by the polling fallback to refresh a known set
  // without scanning the whole table.
  ids: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

imagesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = ListQuerySchema.parse(req.query);

    // The id-set path skips pagination entirely - we want exactly those rows.
    if (query.ids) {
      const ids = query.ids.split(",").filter((s) => s.length > 0);
      const images = await prisma.image.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: "desc" },
      });
      const response: ListImagesResponse = {
        images: await toImageDtos(images),
        total: images.length,
      };
      res.json(response);
      return;
    }

    const where = query.status ? { status: query.status } : undefined;
    const [images, total] = await Promise.all([
      prisma.image.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
      }),
      prisma.image.count({ where }),
    ]);

    const response: ListImagesResponse = {
      images: await toImageDtos(images),
      total,
    };
    res.json(response);
  }),
);

// --- GET /api/images/:id --------------------------------------------------

imagesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) throw httpErrors.notFound("IMAGE_NOT_FOUND", "Image not found");

    const response: GetImageResponse = { image: await toImageDto(image) };
    res.json(response);
  }),
);

// --- DELETE /api/images/:id ----------------------------------------------

imagesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) throw httpErrors.notFound("IMAGE_NOT_FOUND", "Image not found");

    // Delete the row first - the user-visible "is it gone?" question is
    // answered by the DB, not S3. If S3 deletes fail we just leave orphans.
    await prisma.image.delete({ where: { id } });

    // Best-effort S3 cleanup. Both keys (original + processed) get removed.
    await Promise.all([
      deleteObjectIfExists(image.s3KeyOriginal),
      image.s3KeyProcessed ? deleteObjectIfExists(image.s3KeyProcessed) : Promise.resolve(),
    ]);

    wsEmit.imageDeleted({ imageId: id });

    const response: DeleteImageResponse = { success: true };
    res.json(response);
  }),
);
