import { describe, test, expect } from "bun:test";
import { hammingDistance, computePHash } from "../../lib/phash.js";
import sharp from "sharp";

describe("hammingDistance", () => {
  test("identical hashes have distance 0", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
  });
  test("single-bit difference has distance 1", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingDistance("0000000000000000", "8000000000000000")).toBe(1);
  });
  test("counts all differing bits", () => {
    expect(hammingDistance("000000000000000f", "00000000000000f0")).toBe(8);
  });
  test("throws on length mismatch", () => {
    expect(() => hammingDistance("0000", "00000000")).toThrow("pHash length mismatch");
  });
});

describe("computePHash", () => {
  async function solidImageBuffer(r: number, g: number, b: number): Promise<Buffer> {
    return sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } })
      .jpeg()
      .toBuffer();
  }

  test("returns a 16-character hex string", async () => {
    const buf = await solidImageBuffer(128, 128, 128);
    const hash = await computePHash(buf);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
  test("same image produces same hash", async () => {
    const buf = await solidImageBuffer(100, 150, 200);
    const h1 = await computePHash(buf);
    const h2 = await computePHash(buf);
    expect(h1).toBe(h2);
  });
  test("identical images have Hamming distance 0", async () => {
    const buf = await solidImageBuffer(80, 80, 80);
    const h1 = await computePHash(buf);
    const h2 = await computePHash(buf);
    expect(hammingDistance(h1, h2)).toBe(0);
  });
  test("very different images have large Hamming distance", async () => {
    const black = await solidImageBuffer(0, 0, 0);
    const white = await solidImageBuffer(255, 255, 255);
    const h1 = await computePHash(black);
    const h2 = await computePHash(white);
    expect(hammingDistance(h1, h2)).toBeGreaterThan(8);
  });
});
