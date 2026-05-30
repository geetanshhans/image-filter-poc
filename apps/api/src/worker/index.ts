// Validation worker entrypoint. The gate before the processing pipeline.
//
// Behavior is unchanged from Part 1 - this file now just wires the existing
// validation handler into the shared stream-consumer harness. The harness owns
// the Redis loop, retry/reclaim, and dead-lettering; the handler owns the
// validation logic itself.

import { env } from "../config/env.js";
import { loadFaceApi } from "../lib/face-api.js";
import { logger } from "../lib/logger.js";
import { STREAMS, connectRedis } from "../lib/redis.js";
import { ensureConsumerGroup } from "../queue/producer.js";
import { processImage } from "./process-image.js";
import { runStreamConsumer } from "./stream-consumer.js";

async function main(): Promise<void> {
  logger.info(`Validation worker starting (env=${env.NODE_ENV})`);
  await connectRedis();
  await ensureConsumerGroup();
  // Warm the face-api model so the first image doesn't pay the load cost.
  await loadFaceApi();

  await runStreamConsumer({
    name: "validation",
    stream: STREAMS.validation,
    group: STREAMS.validationGroup,
    deadLetter: STREAMS.validationDeadLetter,
    handler: processImage,
  });
}

main().catch((err) => {
  logger.error("Fatal validation worker error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info(`Validation worker received ${signal}, exiting`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
