import { describe, test, expect } from "bun:test";
import { sizeValidator } from "../../validators/size.js";
import type { ValidationContext } from "../../validators/types.js";

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    imageId: "test-id",
    buffer: Buffer.alloc(0),
    mimeType: "image/jpeg",
    width: 1000,
    height: 1000,
    originalSizeBytes: 100_000,
    originalMimeType: "image/jpeg",
    ...overrides,
  };
}

describe("sizeValidator", () => {
  test("passes when size and dimensions meet minimums", () => {
    const result = sizeValidator.run(ctx());
    expect(result).toEqual({ ok: true });
  });
  test("rejects when file is below minimum bytes", () => {
    const result = sizeValidator.run(ctx({ originalSizeBytes: 1000 }));
    expect(result).toMatchObject({ ok: false, reason: "SIZE_TOO_SMALL" });
  });
  test("rejects when width is too small", () => {
    const result = sizeValidator.run(ctx({ width: 100 }));
    expect(result).toMatchObject({ ok: false, reason: "RESOLUTION_TOO_SMALL" });
  });
  test("rejects when height is too small", () => {
    const result = sizeValidator.run(ctx({ height: 100 }));
    expect(result).toMatchObject({ ok: false, reason: "RESOLUTION_TOO_SMALL" });
  });
  test("rejects file-size before dimensions (pipeline order)", () => {
    const result = sizeValidator.run(ctx({ originalSizeBytes: 100, width: 100 }));
    expect(result).toMatchObject({ ok: false, reason: "SIZE_TOO_SMALL" });
  });
  test("passes at exact minimums", () => {
    const result = sizeValidator.run(ctx({ originalSizeBytes: 51200, width: 512, height: 512 }));
    expect(result).toEqual({ ok: true });
  });
  test("rejection detail mentions actual and threshold values", () => {
    const result = sizeValidator.run(ctx({ originalSizeBytes: 100 }));
    if (!result.ok) {
      expect(result.detail).toContain("100");
      expect(result.detail).toContain("51200");
    }
  });
});
