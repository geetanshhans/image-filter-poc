// Convert worker entrypoint. Stage 1 of the pipeline.

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { STREAMS, connectRedis } from "../../lib/redis.js";
import { ensureConvertGroup } from "../../queue/producer.js";
import { runStreamConsumer } from "../stream-consumer.js";
import { handleConvert } from "./handler.js";

async function main(): Promise<void> {
  logger.info(`Convert worker starting (env=${env.NODE_ENV})`);
  await connectRedis();
  await ensureConvertGroup();

  await runStreamConsumer({
    name: "convert",
    stream: STREAMS.convert,
    group: STREAMS.convertGroup,
    deadLetter: STREAMS.convertDeadLetter,
    handler: handleConvert,
  });
}

main().catch((err) => {
  logger.error("Fatal convert worker error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info(`Convert worker received ${signal}, exiting`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
