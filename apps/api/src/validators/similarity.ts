// Similarity check using perceptual hashes.
//
// On every accepted image we store the pHash. When a new image comes in we:
//   1. Compute its pHash.
//   2. Compare against the pHashes of all currently-accepted images.
//   3. If any one is within the Hamming-distance threshold, reject as TOO_SIMILAR.
//
// We only compare against ACCEPTED images, not REJECTED ones, because
// "this is similar to a photo we already kept" is the meaningful constraint -
// the user shouldn't get blocked because they retried after a previous rejection.
//
// The pHash is also written back into the validation context so the worker
// can persist it on the row after all checks pass.

import { RejectionReason } from "@argon/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { computePHash, hammingDistance } from "../lib/phash.js";
import type { Validator, ValidationContext } from "./types.js";

// We attach the computed hash so the runner can read it after validation passes.
export interface ContextWithPHash extends ValidationContext {
  pHash?: string;
}

export const similarityValidator: Validator = {
  name: "similarity",
  async run(ctx) {
    const hash = await computePHash(ctx.buffer);
    // Stash the hash on the context for downstream persistence.
    (ctx as ContextWithPHash).pHash = hash;

    // Pull only the columns we need. For tens of thousands of images this is
    // still fine because pHashes are tiny (16 chars) and we're scanning anyway.
    // Beyond that, switch to a vector index or a probabilistic structure like
    // a BK-tree.
    const existing = await prisma.image.findMany({
      where: {
        status: "ACCEPTED",
        pHash: { not: null },
        // Don't compare against ourselves on a re-run.
        NOT: { id: ctx.imageId },
      },
      select: { id: true, pHash: true },
    });

    for (const other of existing) {
      if (!other.pHash) continue;
      const distance = hammingDistance(hash, other.pHash);
      if (distance <= env.SIMILARITY_HAMMING_THRESHOLD) {
        return {
          ok: false,
          reason: RejectionReason.TooSimilar,
          detail: `Hamming distance ${distance} to image ${other.id} is within threshold ${env.SIMILARITY_HAMMING_THRESHOLD}`,
        };
      }
    }

    return { ok: true };
  },
};
