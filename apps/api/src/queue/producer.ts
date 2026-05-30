// Writes jobs onto Redis Streams and ensures the consumer groups exist.
// One stream per pipeline stage so workers scale independently and a backlog
// on one stage doesn't block the others.

import { redis, STREAMS } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

export interface StageJob {
  imageId: string;
}

// Validation - the gate. Original Part 1 behavior unchanged.
export async function enqueueValidation(job: StageJob): Promise<string> {
  const id = await redis.xadd(STREAMS.validation, "*", "imageId", job.imageId);
  logger.debug("Enqueued validation job", { imageId: job.imageId, streamId: id });
  return id ?? "";
}

// Convert - first pipeline stage. Enqueued by the validation worker after
// status transitions to ACCEPTED, and by the reprocess endpoint.
export async function enqueueConvert(job: StageJob): Promise<string> {
  const id = await redis.xadd(STREAMS.convert, "*", "imageId", job.imageId);
  logger.debug("Enqueued convert job", { imageId: job.imageId, streamId: id });
  return id ?? "";
}

// Compress - enqueued by the convert worker when conversion succeeds.
export async function enqueueCompress(job: StageJob): Promise<string> {
  const id = await redis.xadd(STREAMS.compress, "*", "imageId", job.imageId);
  logger.debug("Enqueued compress job", { imageId: job.imageId, streamId: id });
  return id ?? "";
}

// Variants - enqueued by the compress worker. Final pipeline stage.
export async function enqueueVariants(job: StageJob): Promise<string> {
  const id = await redis.xadd(STREAMS.variants, "*", "imageId", job.imageId);
  logger.debug("Enqueued variants job", { imageId: job.imageId, streamId: id });
  return id ?? "";
}

// MKSTREAM creates the stream if it doesn't exist; BUSYGROUP means the group
// already exists, which is fine. Factored out because every worker calls the
// same pattern on boot.
async function createGroup(stream: string, group: string): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, group, "$", "MKSTREAM");
    logger.info("Created Redis Stream consumer group", { stream, group });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("BUSYGROUP")) return; // Already exists - expected on reboot.
    throw err;
  }
}

export async function ensureConsumerGroup(): Promise<void> {
  await createGroup(STREAMS.validation, STREAMS.validationGroup);
}

export async function ensureConvertGroup(): Promise<void> {
  await createGroup(STREAMS.convert, STREAMS.convertGroup);
}

export async function ensureCompressGroup(): Promise<void> {
  await createGroup(STREAMS.compress, STREAMS.compressGroup);
}

export async function ensureVariantsGroup(): Promise<void> {
  await createGroup(STREAMS.variants, STREAMS.variantsGroup);
}
