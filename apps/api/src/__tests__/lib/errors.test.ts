import { describe, test, expect } from "bun:test";
import { HttpError, httpErrors } from "../../lib/errors.js";

describe("HttpError", () => {
  test("stores status, code, and message", () => {
    const err = new HttpError(404, "NOT_FOUND", "thing not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("thing not found");
    expect(err.name).toBe("HttpError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof HttpError).toBe(true);
  });
});

describe("httpErrors", () => {
  test("badRequest produces 400", () => {
    const err = httpErrors.badRequest("BAD", "bad");
    expect(err.status).toBe(400);
    expect(err.code).toBe("BAD");
  });
  test("notFound produces 404", () => {
    expect(httpErrors.notFound("NF", "x").status).toBe(404);
  });
  test("conflict produces 409", () => {
    expect(httpErrors.conflict("C", "x").status).toBe(409);
  });
  test("payloadTooLarge produces 413", () => {
    expect(httpErrors.payloadTooLarge("BIG", "x").status).toBe(413);
  });
  test("unsupportedMediaType produces 415", () => {
    expect(httpErrors.unsupportedMediaType("UM", "x").status).toBe(415);
  });
});
