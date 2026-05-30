// Compress worker entrypoint. Stage 2 of the pipeline.

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { STREAMS, connectRedis } from "../../lib/redis.js";
import { ensureCompressGroup } from "../../queue/producer.js";
import { runStreamConsumer } from "../stream-consumer.js";
import { handleCompress } from "./handler.js";

async function main(): Promise<void> {
  logger.info(`Compress worker starting (env=${env.NODE_ENV})`);
  await connectRedis();
  await ensureCompressGroup();

  await runStreamConsumer({
    name: "compress",
    stream: STREAMS.compress,
    group: STREAMS.compressGroup,
    deadLetter: STREAMS.compressDeadLetter,
    handler: handleCompress,
  });
}

main().catch((err) => {
  logger.error("Fatal compress worker error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info(`Compress worker received ${signal}, exiting`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
