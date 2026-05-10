// Helpers for picking the right file extension from a mime type or filename.
// Centralized so we don't have parallel maps drifting in different files.

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
};

export function extensionFromMime(mimeType: string): string | null {
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? null;
}

export function extensionFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

// Picks the best available extension - mime first, fallback to filename.
// Some browsers report HEIC files with an empty mime type so the filename
// matters as a backup.
export function resolveExtension(mimeType: string, originalName: string): string | null {
  const fromMime = extensionFromMime(mimeType);
  if (fromMime) return fromMime;
  const fromName = extensionFromName(originalName);
  if (["jpg", "jpeg", "png", "heic", "heif"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  return null;
}
