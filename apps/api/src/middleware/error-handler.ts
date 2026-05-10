// Catches anything thrown from request handlers and converts it into a
// well-shaped JSON error response. Every error response in the API has the
// same shape (matches ApiError in shared/dto.ts) so the frontend has one
// place to handle errors.

import type { ErrorRequestHandler } from "express";
import type { ApiError } from "@argon/shared";
import { ZodError } from "zod";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: ApiError = { error: { code: err.code, message: err.message } };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    // Concatenate validation issues into a single human-readable message.
    // The frontend mostly cares that something failed; the detail helps a
    // developer reading server logs or curl output.
    const message = err.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    const body: ApiError = { error: { code: "INVALID_REQUEST", message } };
    res.status(400).json(body);
    return;
  }

  logger.error("Unhandled error", { error: err instanceof Error ? err.message : String(err) });
  const body: ApiError = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong. Please try again.",
    },
  };
  res.status(500).json(body);
};
