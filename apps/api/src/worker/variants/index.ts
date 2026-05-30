// Variants worker entrypoint. Stage 3 (final) of the pipeline.
//
// Also hosts the reconciler. The reconciler is global rather than per-stage so
// we don't have N copies racing each other. Running it in the variants worker
// is arbitrary - just needs to be one place.

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { STREAMS, connectRedis } from "../../lib/redis.js";
import { ensureVariantsGroup } from "../../queue/producer.js";
import { startReconciler } from "../reconciler.js";
import { runStreamConsumer } from "../stream-consumer.js";
import { handleVariants } from "./handler.js";

async function main(): Promise<void> {
  logger.info(`Variants worker starting (env=${env.NODE_ENV})`);
  await connectRedis();
  await ensureVariantsGroup();

  // Reconciler kicks off as a fire-and-forget interval. It handles the gap
  // class where a stage updated the DB but crashed before enqueueing the next.
  startReconciler();

  await runStreamConsumer({
    name: "variants",
    stream: STREAMS.variants,
    group: STREAMS.variantsGroup,
    deadLetter: STREAMS.variantsDeadLetter,
    handler: handleVariants,
  });
}

main().catch((err) => {
  logger.error("Fatal variants worker error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info(`Variants worker received ${signal}, exiting`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
