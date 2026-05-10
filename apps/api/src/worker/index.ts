// Validation worker. Runs in its own process so a slow image pipeline doesn't
// block HTTP request handling and so we can scale workers independently.
//
// Flow:
//   1. On boot: ensure consumer group exists, reclaim any abandoned messages.
//   2. Loop: XREADGROUP with a 5s block. Process each message. XACK on success.
//   3. On failure: leave the message unacked. After delivery-count exceeds
//      the retry limit, move it to a dead-letter stream so it stops being
//      retried forever.
//
// We deliberately don't use BullMQ here - Redis Streams give us ordered
// delivery, consumer groups, ack semantics, and pending-list recovery
// without an extra abstraction layer.

import { ImageStatus, RejectionReason } from "@argon/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { loadFaceApi } from "../lib/face-api.js";
import { logger } from "../lib/logger.js";
import {
  STREAMS,
  connectRedis,
  createBlockingRedisClient,
  redis,
} from "../lib/redis.js";
import { ensureConsumerGroup } from "../queue/producer.js";
import { toImageDto } from "../lib/image-dto.js";
import { wsEmit } from "../ws/emitter.js";
import { processImage } from "./process-image.js";

// Stream constants. Tuned for "responsive enough" without hammering Redis.
const BLOCK_MS = 5_000;
const BATCH_SIZE = 4;
// Messages stuck in pending for longer than this are reclaimed by other workers.
// Longer than the slowest expected pipeline run plus some headroom.
const RECLAIM_IDLE_MS = 60_000;
const MAX_DELIVERIES = 3;

// Each worker instance gets a unique consumer name within the group so Redis
// can track which worker owns which pending messages. Adding the pid lets
// multiple workers run on the same host without colliding.
const CONSUMER_NAME = `worker-${process.pid}-${Date.now()}`;

// Move a message we've given up on into the dead-letter stream, then ack
// the original so it stops being redelivered. The dead-letter entry preserves
// the imageId for forensics.
async function deadLetter(streamId: string, imageId: string, reason: string): Promise<void> {
  await redis.xadd(
    STREAMS.validationDeadLetter,
    "*",
    "imageId",
    imageId,
    "originalId",
    streamId,
    "reason",
    reason,
  );
  await redis.xack(STREAMS.validation, STREAMS.validationGroup, streamId);
  // Mark the image so the user sees it as rejected with a generic error
  // rather than getting stuck on PROCESSING forever.
  try {
    const updated = await prisma.image.update({
      where: { id: imageId },
      data: {
        status: ImageStatus.Rejected,
        rejectionReason: RejectionReason.ProcessingError,
        rejectionDetail: reason.slice(0, 500),
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

// Reclaims messages from dead/stalled consumers using XAUTOCLAIM. Run on boot
// and periodically thereafter so a crashed worker's in-flight messages get
// picked up by another worker rather than sitting in pending forever.
async function reclaimStalled(): Promise<void> {
  // XAUTOCLAIM returns [nextCursor, claimedMessages, deletedIds]. We don't
  // care about the cursor for our scale; we just claim a batch and move on.
  const result = (await redis.xautoclaim(
    STREAMS.validation,
    STREAMS.validationGroup,
    CONSUMER_NAME,
    RECLAIM_IDLE_MS,
    "0-0",
    "COUNT",
    50,
  )) as [string, Array<[string, string[]]>, string[]];

  const claimed = result[1];
  if (claimed.length === 0) return;
  logger.info("Reclaimed stalled messages", { count: claimed.length });
  for (const [streamId, fields] of claimed) {
    await handleMessage(streamId, fields);
  }
}

// Parse the field array Redis returns into an object. Fields come back as
// [k1, v1, k2, v2, ...] which is awkward to work with directly.
function parseFields(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key !== undefined && value !== undefined) out[key] = value;
  }
  return out;
}

async function handleMessage(streamId: string, fields: string[]): Promise<void> {
  const data = parseFields(fields);
  const imageId = data.imageId;
  if (!imageId) {
    logger.warn("Malformed stream entry, acking and skipping", { streamId });
    await redis.xack(STREAMS.validation, STREAMS.validationGroup, streamId);
    return;
  }

  // Ask Redis how many times this message has been delivered. If we're past
  // the retry budget, dead-letter it instead of trying again.
  const pending = (await redis.xpending(
    STREAMS.validation,
    STREAMS.validationGroup,
    "IDLE",
    0,
    streamId,
    streamId,
    1,
  )) as Array<[string, string, number, number]>;
  const deliveryCount = pending[0]?.[3] ?? 1;

  if (deliveryCount > MAX_DELIVERIES) {
    logger.error("Exceeded max retries, dead-lettering", {
      imageId,
      streamId,
      deliveryCount,
    });
    await deadLetter(streamId, imageId, `Exceeded max delivery count of ${MAX_DELIVERIES}`);
    return;
  }

  try {
    await processImage(imageId);
    await redis.xack(STREAMS.validation, STREAMS.validationGroup, streamId);
  } catch (err) {
    // Leave the message unacked. It'll come back via the next reclaim.
    logger.error("processImage threw, leaving message unacked for retry", {
      imageId,
      streamId,
      deliveryCount,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function consumeLoop(): Promise<void> {
  // XREADGROUP blocks the connection until a message arrives or BLOCK_MS
  // elapses. Using a dedicated client means we don't tie up the producer client.
  const blockingClient = createBlockingRedisClient();

  // ">" means "deliver only new messages, not anything in pending for me".
  // The reclaim path handles pending messages separately.
  while (true) {
    try {
      const result = (await blockingClient.xreadgroup(
        "GROUP",
        STREAMS.validationGroup,
        CONSUMER_NAME,
        "COUNT",
        BATCH_SIZE,
        "BLOCK",
        BLOCK_MS,
        "STREAMS",
        STREAMS.validation,
        ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!result) {
        // Timeout with no messages. Use the idle window to scan for stalled
        // entries so we don't need a separate timer.
        await reclaimStalled().catch((err) => {
          logger.warn("Reclaim sweep failed", {
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
      logger.error("Consumer loop error, backing off 1s", {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  logger.info(`Worker starting (consumer=${CONSUMER_NAME}, env=${env.NODE_ENV})`);
  await connectRedis();
  await ensureConsumerGroup();
  // Warm the face-api model so the first image doesn't pay the load cost.
  await loadFaceApi();
  logger.info("Worker ready, entering consume loop");
  await consumeLoop();
}

main().catch((err) => {
  logger.error("Fatal worker error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

const shutdown = (signal: string) => {
  logger.info(`Worker received ${signal}, exiting`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
