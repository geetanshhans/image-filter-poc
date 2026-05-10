// REST request and response shapes. The API and the frontend both import from here
// so a renamed field becomes a compile error on whichever side hasn't been updated.

import type { AllowedMimeType } from "./constants.js";
import type { ImageStatus, RejectionReason } from "./status.js";

// ---------- Common ----------

export interface ImageDto {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  status: ImageStatus;
  rejectionReason: RejectionReason | null;
  // Pre-signed GET URL for displaying the image. Null if the upload hasn't completed.
  previewUrl: string | null;
  createdAt: string;
}

// ---------- POST /api/uploads/batch ----------

export interface BatchUploadRequestItem {
  originalName: string;
  mimeType: AllowedMimeType | string;
  sizeBytes: number;
}

export interface BatchUploadRequest {
  files: BatchUploadRequestItem[];
}

export interface BatchUploadResponseItem {
  // Local index in the request, so the client can match responses back to its files.
  index: number;
  imageId: string;
  // Pre-signed PUT URL the browser uploads to directly.
  uploadUrl: string;
  // The exact key the API expects to find the object at in S3.
  s3Key: string;
}

export interface BatchUploadResponse {
  items: BatchUploadResponseItem[];
}

// ---------- POST /api/uploads/:id/complete ----------

// No request body needed. Body kept as an empty interface so the client and
// server can extend it later (e.g. client-computed sha256) without breaking signatures.
export interface CompleteUploadRequest {}
export interface CompleteUploadResponse {
  image: ImageDto;
}

// ---------- GET /api/images ----------

export interface ListImagesQuery {
  status?: ImageStatus;
  // Comma-separated list of IDs, used by the polling fallback to fetch only what changed.
  ids?: string;
  limit?: number;
  offset?: number;
}

export interface ListImagesResponse {
  images: ImageDto[];
  total: number;
}

// ---------- GET /api/images/:id ----------

export interface GetImageResponse {
  image: ImageDto;
}

// ---------- DELETE /api/images/:id ----------

export interface DeleteImageResponse {
  success: true;
}

// ---------- Error shape ----------

// All non-2xx responses use this shape.
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
