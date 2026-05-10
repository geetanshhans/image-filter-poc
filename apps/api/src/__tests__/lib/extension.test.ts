import { describe, test, expect } from "bun:test";
import {
  extensionFromMime,
  extensionFromName,
  resolveExtension,
} from "../../lib/extension.js";

describe("extensionFromMime", () => {
  test("maps known types", () => {
    expect(extensionFromMime("image/jpeg")).toBe("jpg");
    expect(extensionFromMime("image/png")).toBe("png");
    expect(extensionFromMime("image/heic")).toBe("heic");
    expect(extensionFromMime("image/heif")).toBe("heif");
  });
  test("is case-insensitive", () => {
    expect(extensionFromMime("IMAGE/JPEG")).toBe("jpg");
    expect(extensionFromMime("Image/PNG")).toBe("png");
  });
  test("returns null for unknown types", () => {
    expect(extensionFromMime("image/webp")).toBeNull();
    expect(extensionFromMime("application/pdf")).toBeNull();
    expect(extensionFromMime("")).toBeNull();
  });
});

describe("extensionFromName", () => {
  test("extracts extension", () => {
    expect(extensionFromName("photo.jpg")).toBe("jpg");
    expect(extensionFromName("photo.JPG")).toBe("jpg");
    expect(extensionFromName("my.photo.heic")).toBe("heic");
  });
  test("returns empty string when no dot", () => {
    expect(extensionFromName("noext")).toBe("");
  });
});

describe("resolveExtension", () => {
  test("prefers mime type over filename", () => {
    expect(resolveExtension("image/jpeg", "photo.png")).toBe("jpg");
  });
  test("falls back to filename when mime unknown", () => {
    expect(resolveExtension("", "photo.jpg")).toBe("jpg");
    expect(resolveExtension("application/octet-stream", "photo.heic")).toBe("heic");
  });
  test("normalises jpeg -> jpg from filename", () => {
    expect(resolveExtension("", "photo.jpeg")).toBe("jpg");
  });
  test("returns null for unsupported combinations", () => {
    expect(resolveExtension("image/webp", "photo.webp")).toBeNull();
    expect(resolveExtension("", "photo.gif")).toBeNull();
  });
});
