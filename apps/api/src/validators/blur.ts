// Blur detection via the variance-of-Laplacian method.
//
// Why this works: a sharp image has lots of high-frequency edges, which the
// Laplacian kernel highlights. The variance of the Laplacian-filtered image
// is a single number that scales with "edge content" - a soft photo has low
// variance, a sharp one has high variance. Empirically, ~100 is a reasonable
// cutoff for "obviously blurry" without being so strict that shallow
// depth-of-field portraits get rejected.
//
// The threshold is exposed via env so reviewers can tune it for their dataset.

import sharp from "sharp";
import { RejectionReason } from "@argon/shared";
import { env } from "../config/env.js";
import type { Validator } from "./types.js";

// 3x3 Laplacian kernel. Sums to zero so flat areas produce zero output.
const LAPLACIAN_KERNEL: sharp.Kernel = {
  width: 3,
  height: 3,
  kernel: [
    0, -1, 0,
    -1, 4, -1,
    0, -1, 0,
  ],
};

// Resize before convolving. We don't need full resolution for a variance
// number, and downsampling speeds the operation up by ~10x on phone-sized
// images. 512px on the long edge keeps enough detail for the metric.
const RESIZE_LONG_EDGE = 512;

async function laplacianVariance(buffer: Buffer): Promise<number> {
  // Convert to grayscale, downsample, run Laplacian, get raw pixel data.
  const { data } = await sharp(buffer)
    .resize(RESIZE_LONG_EDGE, RESIZE_LONG_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .convolve(LAPLACIAN_KERNEL)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Compute variance in a single pass: E[X^2] - E[X]^2.
  let sum = 0;
  let sumSq = 0;
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const v = data[i] ?? 0;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export const blurValidator: Validator = {
  name: "blur",
  async run(ctx) {
    const variance = await laplacianVariance(ctx.buffer);
    if (variance < env.BLUR_LAPLACIAN_THRESHOLD) {
      return {
        ok: false,
        reason: RejectionReason.Blurry,
        detail: `Laplacian variance ${variance.toFixed(2)} below threshold ${env.BLUR_LAPLACIAN_THRESHOLD}`,
      };
    }
    return { ok: true };
  },
};
