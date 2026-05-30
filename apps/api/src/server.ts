// API server entry point. Boots Express, attaches WebSocket, ensures the
// Redis stream consumer group exists, and starts listening.
//
// The validation worker runs as a separate process (npm run dev:worker) so it
// can be scaled independently and so a slow validation pass doesn't block
// HTTP requests.

import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { connectRedis } from "./lib/redis.js";
import {
  ensureCompressGroup,
  ensureConsumerGroup,
  ensureConvertGroup,
  ensureVariantsGroup,
} from "./queue/producer.js";
import { attachWebSocket } from "./ws/server.js";

async function main(): Promise<void> {
  await connectRedis();
  // Create groups (idempotent) so producers - including the reprocess endpoint
  // and the upload completion handler - can XADD even before workers boot.
  await ensureConsumerGroup();
  await ensureConvertGroup();
  await ensureCompressGroup();
  await ensureVariantsGroup();

  const app = createApp();
  const httpServer = createServer(app);
  attachWebSocket(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
    logger.info(`WebSocket ready on ws://localhost:${env.PORT}`);
    logger.info(`CORS origin: ${env.CORS_ORIGIN}`);
  });

  // Clean shutdown so docker-compose / nodemon don't leave orphan connections.
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
