// Express 4 doesn't natively forward async errors to the error middleware.
// Wrapping handlers in this turns rejected promises into next(err) calls,
// which the error handler then catches.

import type { NextFunction, Request, RequestHandler, Response } from "express";

export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
