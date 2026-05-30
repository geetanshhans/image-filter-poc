// Pipeline reconciler. Periodically scans for rows stuck in a non-terminal
// pipeline stage and re-enqueues them onto the appropriate stream.
//
// Why this is needed: every stage handler does
//   (1) S3 write, (2) DB update, (3) enqueue next stage, (4) XACK.
// If a worker crashes between (2) and (3), the row's stage advanced but no
// next-stage message exists. XAUTOCLAIM doesn't help here - the message was
// already acked. The reconciler catches this class by scanning the DB.
//
// Stage handlers are idempotent, so a duplicate enqueue (this reconciler firing
// while a stage is still legitimately running) is safe - the handler sees
// "already past stage" and ack-skips.

import { PipelineStage } from "@argon/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";
import {
  enqueueCompress,
  enqueueConvert,
  enqueueVariants,
} from "../queue/producer.js";

// Map non-terminal stages to their enqueue function. COMPLETE/FAILED aren't
// here - they're terminal so the reconciler ignores them.
const ENQUEUE_BY_STAGE: Record<string, (job: { imageId: string }) => Promise<string>> = {
  [PipelineStage.Converting]: enqueueConvert,
  [PipelineStage.Compressing]: enqueueCompress,
  [PipelineStage.GeneratingVariants]: enqueueVariants,
};

async function runSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - env.RECONCILER_STUCK_AFTER_MS);

  const stuck = await prisma.image.findMany({
    where: {
      pipelineStage: {
        in: [
          PipelineStage.Converting,
          PipelineStage.Compressing,
          PipelineStage.GeneratingVariants,
        ],
      },
      // updatedAt hasn't moved in stuckAfter ms - whatever was doing the work
      // is either dead or genuinely very slow. Re-enqueue either way; the
      // handler's guard makes the slow case a no-op.
      updatedAt: { lt: cutoff },
    },
    select: { id: true, pipelineStage: true },
    take: 100,
  });

  if (stuck.length === 0) return;

  logger.info("reconciler: re-enqueueing stuck rows", { count: stuck.length });
  for (const row of stuck) {
    const enqueue = ENQUEUE_BY_STAGE[row.pipelineStage ?? ""];
    if (!enqueue) continue;
    try {
      await enqueue({ imageId: row.id });
      logger.info("reconciler: re-enqueued", { imageId: row.id, stage: row.pipelineStage });
    } catch (err) {
      logger.error("reconciler: re-enqueue failed", {
        imageId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// Fire-and-forget interval. Safe to run multiple instances (idempotent
// handlers) but we typically only start it in the variants worker.
export function startReconciler(): void {
  const interval = env.RECONCILER_INTERVAL_MS;
  logger.info("reconciler: starting", {
    intervalMs: interval,
    stuckAfterMs: env.RECONCILER_STUCK_AFTER_MS,
  });
  setInterval(() => {
    runSweep().catch((err) => {
      logger.warn("reconciler: sweep failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, interval);
}
