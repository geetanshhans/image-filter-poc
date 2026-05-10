// Pre-flight checks the browser runs before we even talk to the server. The
// real validation happens server-side; this layer just rejects obvious cases
// (wrong format, too big) so we don't waste a round trip and the user gets
// instant feedback.

import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  UI_LIMITS,
} from "@argon/shared";

export interface ClientValidationResult {
  ok: boolean;
  // Human-readable message, shown as a toast for rejected files.
  reason?: string;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function validateFileBeforeUpload(file: File): ClientValidationResult {
  // Some browsers (notably Safari) don't always populate file.type for HEIC
  // uploads. Falling back to the extension keeps those files from being
  // mistakenly rejected.
  const mimeAllowed = (ALLOWED_MIME_TYPES as readonly string[]).includes(file.type);
  const ext = getExtension(file.name);
  const extAllowed = (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
  if (!mimeAllowed && !extAllowed) {
    return {
      ok: false,
      reason: `${file.name} isn't a supported format. Use JPG, PNG, or HEIC.`,
    };
  }

  if (file.size > UI_LIMITS.maxFileSizeBytes) {
    const mb = Math.round(UI_LIMITS.maxFileSizeBytes / (1024 * 1024));
    return {
      ok: false,
      reason: `${file.name} is larger than ${mb}MB.`,
    };
  }

  return { ok: true };
}

export function isHeicFile(file: File): boolean {
  const ext = getExtension(file.name);
  return file.type === "image/heic" || file.type === "image/heif" || ext === "heic" || ext === "heif";
}
