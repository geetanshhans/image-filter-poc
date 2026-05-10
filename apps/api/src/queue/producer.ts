// Writes validation jobs onto the Redis Stream. The worker reads them via
// XREADGROUP. We use a stream (not a list) so we get consumer groups, ack/nack,
// and pending-entry recovery for free.

import { redis, STREAMS } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

export interface ValidationJob {
  imageId: string;
}

// Add a job and return the resulting stream ID. The ID is timestamp-based
// (e.g. "1704067200000-0") and ordered, so consumers process roughly FIFO.
export async function enqueueValidation(job: ValidationJob): Promise<string> {
  const id = await redis.xadd(
    STREAMS.validation,
    "*",
    "imageId",
    job.imageId,
  );
  logger.debug("Enqueued validation job", { imageId: job.imageId, streamId: id });
  // ioredis types the return as `string | null`; in practice XADD only returns
  // null when NOMKSTREAM is set, which we don't pass.
  return id ?? "";
}

// Initialize the consumer group on boot. MKSTREAM creates the stream if it
// doesn't exist yet so we don't have to write a separate "first run" path.
// BUSYGROUP means the group is already there - safe to ignore.
export async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup(
      "CREATE",
      STREAMS.validation,
      STREAMS.validationGroup,
      "$",
      "MKSTREAM",
    );
    logger.info("Created Redis Stream consumer group", {
      stream: STREAMS.validation,
      group: STREAMS.validationGroup,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("BUSYGROUP")) {
      // Group already exists. Expected on every boot after the first.
      return;
    }
    throw err;
  }
}
