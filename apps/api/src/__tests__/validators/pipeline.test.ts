import { describe, test, expect, mock } from "bun:test";
import sharp from "sharp";

mock.module("../../lib/face-api.js", () => ({
  detectFaces: mock(() => Promise.resolve([{ x: 0, y: 0, width: 200, height: 200 }])),
}));

mock.module("../../db/prisma.js", () => ({
  prisma: {
    image: {
      findMany: mock(() => Promise.resolve([])),
    },
  },
}));

const { runPipeline } = await import("../../validators/pipeline.js");
const { detectFaces } = await import("../../lib/face-api.js");
const { prisma } = await import("../../db/prisma.js");

async function makeJpeg(opts: { width?: number; height?: number; noisy?: boolean } = {}): Promise<Buffer> {
  const w = opts.width ?? 1024;
  const h = opts.height ?? 1024;

  if (opts.noisy ?? true) {
    const pixels = Buffer.alloc(w * h * 3);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = Math.random() < 0.5 ? 0 : 255;
    }
    return sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
  } else {
    return sharp({
      create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();
  }
}

describe("runPipeline", () => {
  describe("size rejections (first in pipeline)", () => {
    test("rejects when file is too small in bytes", async () => {
      const buf = await makeJpeg({ noisy: false });
      const output = await runPipeline({
        imageId: "test",
        buffer: buf,
        mimeType: "image/jpeg",
        sizeBytes: 100,
      });
      expect(output.result).toMatchObject({ ok: false, reason: "SIZE_TOO_SMALL" });
    });
    test("rejects when resolution is too small", async () => {
      const buf = await makeJpeg({ width: 100, height: 100, noisy: false });
      const output = await runPipeline({
        imageId: "test",
        buffer: buf,
        mimeType: "image/jpeg",
        sizeBytes: 100_000,
      });
      expect(output.result).toMatchObject({ ok: false, reason: "RESOLUTION_TOO_SMALL" });
    });
  });

  describe("blur rejection (second in pipeline)", () => {
    test("rejects a flat (blurry) image that passes size", async () => {
      const buf = await makeJpeg({ noisy: false });
      const output = await runPipeline({
        imageId: "test",
        buffer: buf,
        mimeType: "image/jpeg",
        sizeBytes: 100_000,
      });
      expect(output.result).toMatchObject({ ok: false, reason: "BLURRY" });
    });
  });

  describe("face rejections (third in pipeline)", () => {
    async function sharpInput() {
      const buf = await makeJpeg({ noisy: true });
      return { imageId: "test", buffer: buf, mimeType: "image/jpeg", sizeBytes: 100_000 };
    }

    test("rejects when no faces detected", async () => {
      (detectFaces as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([]),
      );
      const output = await runPipeline(await sharpInput());
      expect(output.result).toMatchObject({ ok: false, reason: "NO_FACE" });
    });
    test("rejects when multiple faces detected", async () => {
      (detectFaces as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 200, y: 200, width: 100, height: 100 },
        ]),
      );
      const output = await runPipeline(await sharpInput());
      expect(output.result).toMatchObject({ ok: false, reason: "MULTIPLE_FACES" });
    });
    test("rejects when face area ratio is too small", async () => {
      (detectFaces as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([{ x: 0, y: 0, width: 10, height: 10 }]),
      );
      const output = await runPipeline(await sharpInput());
      expect(output.result).toMatchObject({ ok: false, reason: "FACE_TOO_SMALL" });
    });
  });

  describe("similarity rejection (last in pipeline)", () => {
    test("rejects when a similar image already exists", async () => {
      (detectFaces as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([{ x: 0, y: 0, width: 500, height: 500 }]),
      );
      const buf = await makeJpeg({ noisy: true });
      const input = { imageId: "test", buffer: buf, mimeType: "image/jpeg", sizeBytes: 100_000 };
      const { computePHash } = await import("../../lib/phash.js");
      const hash = await computePHash(buf);
      (prisma.image.findMany as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([{ id: "other-img", pHash: hash }]),
      );
      const output = await runPipeline(input);
      expect(output.result).toMatchObject({ ok: false, reason: "TOO_SIMILAR" });
    });
  });

  describe("successful pass", () => {
    test("returns ok:true and pHash for a valid image", async () => {
      (detectFaces as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([{ x: 0, y: 0, width: 500, height: 500 }]),
      );
      (prisma.image.findMany as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve([]),
      );
      const buf = await makeJpeg({ noisy: true });
      const output = await runPipeline({
        imageId: "test",
        buffer: buf,
        mimeType: "image/jpeg",
        sizeBytes: 100_000,
      });
      expect(output.result).toEqual({ ok: true });
      expect(output.pHash).toMatch(/^[0-9a-f]{16}$/);
      expect(output.width).toBeGreaterThan(0);
      expect(output.height).toBeGreaterThan(0);
    });
  });

  describe("HEIC mime detection", () => {
    test("isHeicMime identifies HEIC variants", async () => {
      const { isHeicMime } = await import("../../lib/heic.js");
      expect(isHeicMime("image/heic")).toBe(true);
      expect(isHeicMime("image/heif")).toBe(true);
      expect(isHeicMime("image/jpeg")).toBe(false);
      expect(isHeicMime("IMAGE/HEIC")).toBe(true);
    });
  });
});
