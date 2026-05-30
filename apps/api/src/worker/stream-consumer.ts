// Generic Redis Streams consumer harness used by every worker in the pipeline.
//
// Each worker (validation, convert, compress, variants) is just a thin wrapper
// that calls runStreamConsumer() with its own stream name, consumer group, and
// per-message handler. Extracting the loop here means:
//   - one place to fix bugs in retry/reclaim/dead-letter semantics
//   - new pipeline stages take ~20 LOC each
//   - validation worker behavior is unchanged (it now goes through this loop too)
//
// Lifecycle for each delivered message:
//   1. Parse fields -> { imageId }. Malformed entries are acked and skipped.
//   2. Check delivery count via XPENDING. Past MAX_DELIVERIES -> dead-letter + ack.
//   3. Call handler(imageId).
//      - returns normally -> XACK.
//      - throws -> leave unacked. XAUTOCLAIM picks it up on the next idle pass.
//
// Why we don't catch handler errors and ack: a transient failure (S3 blip,
// DB connection drop) should retry. A permanent failure should be turned by
// the handler itself into a terminal DB state (pipelineStage=FAILED) and then
// return normally - that way the message acks and doesn't keep retrying.

import { ImageStatus, RejectionReason } from "@argon/shared";
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";
import { toImageDto } from "../lib/image-dto.js";
import {
  createBlockingRedisClient,
  redis,
} from "../lib/redis.js";
import { wsEmit } from "../ws/emitter.js";

const BLOCK_MS = 5_000;
const BATCH_SIZE = 4;
// Messages stuck in pending longer than this are reclaimed by other workers.
// Longer than the slowest expected handler run plus headroom.
const RECLAIM_IDLE_MS = 60_000;
const MAX_DELIVERIES = 3;

export interface StreamConsumerConfig {
  // Display name for logs (e.g. "validation", "convert").
  name: string;
  // Stream key (e.g. "argon:images:convert").
  stream: string;
  // Consumer group name.
  group: string;
  // Dead-letter stream key. Entries here are not auto-retried.
  deadLetter: string;
  // Per-message handler. Receives the imageId, must do its own DB/S3 work.
  // Throw to leave the message unacked (will retry); return to ack.
  handler: (imageId: string) => Promise<void>;
  // Called after MAX_DELIVERIES is exceeded. Default: mark image REJECTED with
  // a ProcessingError. Override if a stage wants different terminal behavior.
  onDeadLetter?: (imageId: string, reason: string) => Promise<void>;
}

function parseFields(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

// Default dead-letter behavior: flip the image to REJECTED with a generic
// processing error. Mirrors the existing validation worker behavior so the
// user-visible outcome is consistent when any stage permanently fails.
async function defaultDeadLetter(imageId: string, reason: string): Promise<void> {
  try {
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        status: ImageStatus.Rejected,
        rejectionReason: RejectionReason.ProcessingError,
        rejectionDetail: reason.slice(0, 500),
        // If the image had entered the pipeline, mark it FAILED so the UI
        // surfaces the pipeline error path rather than a validation error.
        pipelineError: reason.slice(0, 500),
      },
    });
    wsEmit.imageStatus({ image: await toImageDto(updated) });
  } catch (err) {
    logger.error("Failed to mark image as rejected after dead-letter", {
      imageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runStreamConsumer(config: StreamConsumerConfig): Promise<void> {
  // Each instance gets a unique consumer name within the group so Redis
  // can track pending-list ownership across multiple workers on one host.
  const consumerName = `${config.name}-${process.pid}-${Date.now()}`;

  async function deadLetter(streamId: string, imageId: string, reason: string): Promise<void> {
    await redis.xadd(
      config.deadLetter,
      "*",
      "imageId", imageId,
      "originalId", streamId,
      "reason", reason,
    );
    await redis.xack(config.stream, config.group, streamId);
    const onDead = config.onDeadLetter ?? defaultDeadLetter;
    await onDead(imageId, reason);
  }

  async function handleMessage(streamId: string, fields: string[]): Promise<void> {
    const data = parseFields(fields);
    const imageId = data.imageId;
    if (!imageId) {
      logger.warn(`${config.name}: malformed stream entry, acking`, { streamId });
      await redis.xack(config.stream, config.group, streamId);
      return;
    }

    // Check delivery count. If past the retry budget, dead-letter.
    const pending = (await redis.xpending(
      config.stream,
      config.group,
      "IDLE", 0,
      streamId, streamId, 1,
    )) as Array<[string, string, number, number]>;
    const deliveryCount = pending[0]?.[3] ?? 1;

    if (deliveryCount > MAX_DELIVERIES) {
      logger.error(`${config.name}: exceeded max retries, dead-lettering`, {
        imageId, streamId, deliveryCount,
      });
      await deadLetter(streamId, imageId, `Exceeded max delivery count of ${MAX_DELIVERIES}`);
      return;
    }

    try {
      await config.handler(imageId);
      await redis.xack(config.stream, config.group, streamId);
    } catch (err) {
      // Leave unacked; XAUTOCLAIM will reclaim it. Handlers should catch their
      // own permanent errors and translate them to a terminal DB state, only
      // letting transient errors bubble up here.
      logger.error(`${config.name}: handler threw, leaving unacked for retry`, {
        imageId, streamId, deliveryCount,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function reclaimStalled(): Promise<void> {
    const result = (await redis.xautoclaim(
      config.stream,
      config.group,
      consumerName,
      RECLAIM_IDLE_MS,
      "0-0",
      "COUNT", 50,
    )) as [string, Array<[string, string[]]>, string[]];

    const claimed = result[1];
    if (claimed.length === 0) return;
    logger.info(`${config.name}: reclaimed stalled messages`, { count: claimed.length });
    for (const [streamId, fields] of claimed) {
      await handleMessage(streamId, fields);
    }
  }

  // XREADGROUP blocks the connection until a message arrives or BLOCK_MS
  // elapses. A dedicated client keeps the shared producer connection free.
  const blockingClient = createBlockingRedisClient();
  logger.info(`${config.name}: ready (consumer=${consumerName}, stream=${config.stream})`);

  while (true) {
    try {
      const result = (await blockingClient.xreadgroup(
        "GROUP", config.group, consumerName,
        "COUNT", BATCH_SIZE,
        "BLOCK", BLOCK_MS,
        "STREAMS", config.stream, ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!result) {
        // Idle window - use it for the reclaim sweep so we don't need a timer.
        await reclaimStalled().catch((err) => {
          logger.warn(`${config.name}: reclaim sweep failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        continue;
      }

      for (const [, entries] of result) {
        for (const [streamId, fields] of entries) {
          await handleMessage(streamId, fields);
        }
      }
    } catch (err) {
      logger.error(`${config.name}: consumer loop error, backing off 1s`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
