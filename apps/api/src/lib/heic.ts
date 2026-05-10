// HEIC -> JPEG conversion. Browsers can't render HEIC inline so we always
// convert before serving previews.
//
// sharp's prebuilt binary ships without libde265 (the HEVC decoder), so it
// can't decode HEIC even though libheif is present. We use heic-convert which
// bundles its own WASM decoder and works on any platform without native builds.

import heicConvert from "heic-convert";

export interface ConvertedImage {
  buffer: Buffer;
  // Always image/jpeg after conversion.
  mimeType: "image/jpeg";
  extension: "jpg";
}

export async function convertHeicToJpeg(buffer: Buffer): Promise<ConvertedImage> {
  const output = await heicConvert({
    buffer: buffer,
    format: "JPEG",
    quality: 0.9,
  });
  return { buffer: Buffer.from(output), mimeType: "image/jpeg", extension: "jpg" };
}

// Returns true when the mime type is one of the HEIC variants we need to
// convert. Used by the pipeline to decide whether to run the conversion step.
export function isHeicMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase();
  return m === "image/heic" || m === "image/heif";
}
