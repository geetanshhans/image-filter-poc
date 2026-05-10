import { describe, test, expect } from "bun:test";
import sharp from "sharp";
import { blurValidator } from "../../validators/blur.js";
import type { ValidationContext } from "../../validators/types.js";

async function makeCtx(buffer: Buffer): Promise<ValidationContext> {
  return {
    imageId: "test-id",
    buffer,
    mimeType: "image/jpeg",
    width: 512,
    height: 512,
    originalSizeBytes: buffer.length,
    originalMimeType: "image/jpeg",
  };
}

async function sharpImage(pattern: "sharp" | "blurry"): Promise<Buffer> {
  if (pattern === "sharp") {
    const pixels = Buffer.alloc(512 * 512 * 3);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const val = ((x + y) % 2 === 0) ? 255 : 0;
        const i = (y * 512 + x) * 3;
        pixels[i] = val;
        pixels[i + 1] = val;
        pixels[i + 2] = val;
      }
    }
    return sharp(pixels, { raw: { width: 512, height: 512, channels: 3 } })
      .jpeg()
      .toBuffer();
  } else {
    return sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .jpeg()
      .toBuffer();
  }
}

describe("blurValidator", () => {
  test("accepts a high-contrast (sharp) image", async () => {
    const buf = await sharpImage("sharp");
    const result = await blurValidator.run(await makeCtx(buf));
    expect(result).toEqual({ ok: true });
  });
  test("rejects a flat (blurry) image", async () => {
    const buf = await sharpImage("blurry");
    const result = await blurValidator.run(await makeCtx(buf));
    expect(result).toMatchObject({ ok: false, reason: "BLURRY" });
  });
  test("rejection detail includes variance and threshold", async () => {
    const buf = await sharpImage("blurry");
    const result = await blurValidator.run(await makeCtx(buf));
    if (!result.ok) {
      expect(result.detail).toContain("100");
    }
  });
});
