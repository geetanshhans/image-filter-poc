// Builds the Express app. Kept separate from server.ts so it can be exercised
// directly by tests without spinning up an HTTP listener.

import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { healthRouter } from "./routes/health.js";
import { imagesRouter } from "./routes/images.js";
import { uploadsRouter } from "./routes/uploads.js";

export function createApp() {
  const app = express();

  // Security headers. We override the default CSP because we don't serve any
  // HTML from this API - it's JSON only - so the default's restrictive CSP
  // doesn't actually help us, and it occasionally blocks dev tooling.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );

  // 1MB is plenty for our JSON bodies. Image bytes never come through the API
  // (presigned URLs send them straight to S3) so we don't need a big limit.
  app.use(express.json({ limit: "1mb" }));

  // Compact request log. tiny is one line per request which is enough for dev.
  app.use(morgan(env.NODE_ENV === "development" ? "dev" : "tiny"));

  // GET /api/health        - deep probe (DB, Redis, S3, worker)
  // GET /api/health/ping   - shallow probe for load balancers
  app.use("/api/health", healthRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/images", imagesRouter);

  // Always last - catches anything thrown above.
  app.use(errorHandler);

  return app;
}
