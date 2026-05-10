// Shared types for the validation pipeline. Each validator gets a context
// (the bytes plus computed metadata) and returns either pass or a rejection.

import type { RejectionReason } from "@argon/shared";

export interface ValidationContext {
  imageId: string;
  // Bytes we run validation against. For HEIC inputs this is the converted JPEG.
  buffer: Buffer;
  // Mime type of `buffer` after any conversion.
  mimeType: string;
  // Image dimensions in pixels. Populated after the format step decodes the image.
  width: number;
  height: number;
  // Original input size in bytes (before any conversion).
  originalSizeBytes: number;
  // Original mime type the user uploaded.
  originalMimeType: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason; detail: string };

export interface Validator {
  // Human-friendly name for logging - e.g. "blur", "face count".
  name: string;
  run(ctx: ValidationContext): Promise<ValidationResult> | ValidationResult;
}
