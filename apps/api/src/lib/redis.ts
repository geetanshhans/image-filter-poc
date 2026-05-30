// One Redis client per role. ioredis recommends separate connections for
// blocking commands (XREADGROUP) and regular commands so a long blocking call
// doesn't tie up the connection used for everything else.

import Redis from "ioredis";
import { env } from "../config/env.js";

// Used by the producer side (XADD from request handlers) and any non-blocking
// reads. Cheap to share across handlers since commands are pipelined.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  // Lazy connection so importing this module doesn't fail in tests that
  // don't actually need Redis.
  lazyConnect: true,
});

// Dedicated client used by the worker for XREADGROUP, which blocks the
// connection until a message arrives. Kept separate so the producer client
// stays responsive.
export function createBlockingRedisClient(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

// Stream constants used by both producer and consumer. Exporting them from
// one place keeps the names and group identity consistent.
export const STREAMS = {
  validation: "argon:images:validation",
  validationGroup: "validators",
  validationDeadLetter: "argon:images:validation:dead",

  // Pipeline stages. Each stage has its own stream + group so workers can
  // scale independently and a backlog on one stage doesn't block the others.
  convert: "argon:images:convert",
  convertGroup: "converters",
  convertDeadLetter: "argon:images:convert:dead",

  compress: "argon:images:compress",
  compressGroup: "compressors",
  compressDeadLetter: "argon:images:compress:dead",

  variants: "argon:images:variants",
  variantsGroup: "variant-makers",
  variantsDeadLetter: "argon:images:variants:dead",
} as const;

// Connect on demand. Called at server boot so we fail loudly if Redis is down.
export async function connectRedis(): Promise<void> {
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
}
