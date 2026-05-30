-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('CONVERTING', 'COMPRESSING', 'GENERATING_VARIANTS', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "Image" ADD COLUMN "pipelineStage" "PipelineStage",
                    ADD COLUMN "pipelineError" TEXT,
                    ADD COLUMN "convertedAt" TIMESTAMP(3),
                    ADD COLUMN "compressedAt" TIMESTAMP(3),
                    ADD COLUMN "completedAt" TIMESTAMP(3),
                    ADD COLUMN "s3KeyCompressed" TEXT,
                    ADD COLUMN "compressedBytes" INTEGER,
                    ADD COLUMN "compressionRatio" DOUBLE PRECISION,
                    ADD COLUMN "variants" JSONB;

-- CreateIndex
CREATE INDEX "Image_pipelineStage_updatedAt_idx" ON "Image"("pipelineStage", "updatedAt");
