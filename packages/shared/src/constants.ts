// Numbers the frontend needs to know to enforce client-side checks BEFORE upload.
// Keeping them here means the API and the browser can't disagree.

// Allowed mime types. HEIC has two common variants depending on the source.
export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// Allowed extensions used as a second-line check, since some browsers report
// HEIC files with an empty mime type.
export const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "heic", "heif"] as const;

export const UI_LIMITS = {
  // Hard cap on file size, enforced both client-side (instant feedback) and
  // server-side (the backend's MAX_FILE_SIZE_BYTES env var must match this).
  // 25MB keeps the worker's HEIC-to-JPEG memory footprint reasonable.
  maxFileSizeBytes: 25 * 1024 * 1024,
  // Upload screen targets up to 10 photos. Used to drive the "X of 10" counter
  // and to disable the dropzone once full.
  maxImagesPerSession: 10,
  // Soft minimum that nudges users toward more photos but never blocks them.
  recommendedMinImages: 6,
} as const;
