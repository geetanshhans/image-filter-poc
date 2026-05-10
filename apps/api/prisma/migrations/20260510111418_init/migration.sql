-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('SIZE_TOO_SMALL', 'RESOLUTION_TOO_SMALL', 'INVALID_FORMAT', 'BLURRY', 'NO_FACE', 'MULTIPLE_FACES', 'FACE_TOO_SMALL', 'TOO_SIMILAR', 'PROCESSING_ERROR');

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "s3KeyOriginal" TEXT NOT NULL,
    "s3KeyProcessed" TEXT,
    "status" "ImageStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "rejectionReason" "RejectionReason",
    "rejectionDetail" TEXT,
    "pHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Image_s3KeyOriginal_key" ON "Image"("s3KeyOriginal");

-- CreateIndex
CREATE INDEX "Image_status_createdAt_idx" ON "Image"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Image_pHash_idx" ON "Image"("pHash");
