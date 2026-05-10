// Perceptual hash (pHash) using DCT. Two images that look the same to a
// human produce hashes with a small Hamming distance, even after light
// edits like recompression, slight crops, or color shifts.
//
// Algorithm:
//   1. Downscale to 32x32 grayscale.
//   2. Compute the 2D DCT.
//   3. Take the top-left 8x8 block of DCT coefficients (low frequencies =
//      the "feel" of the image; high frequencies = noise we want to ignore).
//   4. Drop the DC (0,0) component which dominates.
//   5. Compute the median of the remaining 63 values.
//   6. Each bit of the 64-bit hash = 1 if its DCT coefficient > median, else 0.
//
// Compared with average-hash this picks up structural similarity better and
// still runs in tens of milliseconds.

import sharp from "sharp";

const DCT_SIZE = 32;
const HASH_SIZE = 8;

// Pre-computed cosine table. Building it once at module load saves ~30%
// per hash compared with calling Math.cos in the inner loop.
const cosTable: number[][] = (() => {
  const table: number[][] = [];
  for (let k = 0; k < DCT_SIZE; k++) {
    const row: number[] = [];
    for (let n = 0; n < DCT_SIZE; n++) {
      row.push(Math.cos(((2 * n + 1) * k * Math.PI) / (2 * DCT_SIZE)));
    }
    table.push(row);
  }
  return table;
})();

function dct1d(input: number[]): number[] {
  const out = new Array<number>(DCT_SIZE);
  for (let k = 0; k < DCT_SIZE; k++) {
    let sum = 0;
    const row = cosTable[k]!;
    for (let n = 0; n < DCT_SIZE; n++) {
      sum += (input[n] ?? 0) * (row[n] ?? 0);
    }
    out[k] = sum;
  }
  return out;
}

// 2D DCT = DCT of each row, then DCT of each column. Standard separable approach.
function dct2d(matrix: number[][]): number[][] {
  const rowsTransformed = matrix.map(dct1d);
  const result: number[][] = Array.from({ length: DCT_SIZE }, () =>
    new Array<number>(DCT_SIZE).fill(0),
  );
  for (let col = 0; col < DCT_SIZE; col++) {
    const column = rowsTransformed.map((r) => r[col] ?? 0);
    const transformed = dct1d(column);
    for (let row = 0; row < DCT_SIZE; row++) {
      result[row]![col] = transformed[row]!;
    }
  }
  return result;
}

// Returns the 64-bit pHash as a 16-character hex string.
export async function computePHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(DCT_SIZE, DCT_SIZE, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Convert raw bytes into a 32x32 matrix of doubles.
  const matrix: number[][] = [];
  for (let y = 0; y < DCT_SIZE; y++) {
    const row = new Array<number>(DCT_SIZE);
    for (let x = 0; x < DCT_SIZE; x++) {
      row[x] = data[y * DCT_SIZE + x] ?? 0;
    }
    matrix.push(row);
  }

  const dct = dct2d(matrix);

  // Top-left 8x8, excluding DC component.
  const lowFreq: number[] = [];
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      if (x === 0 && y === 0) continue;
      lowFreq.push(dct[y]![x]!);
    }
  }

  // Median - sorting copy is fine for 63 elements.
  const sorted = [...lowFreq].sort((a, b) => a - b);
  const median = (sorted[31]! + sorted[32]!) / 2;

  // Build the 64-bit hash. We include the DC slot as bit 0 to make it a clean
  // 64 bits; its value vs. median is meaningless so it adds at most 1 to any
  // distance, which is well within our threshold.
  let hash = 0n;
  let bit = 0;
  for (let y = 0; y < HASH_SIZE; y++) {
    for (let x = 0; x < HASH_SIZE; x++) {
      const v = x === 0 && y === 0 ? 0 : dct[y]![x]!;
      if (v > median) hash |= 1n << BigInt(bit);
      bit++;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

// Hamming distance between two hex pHashes. Counts differing bits.
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`pHash length mismatch: ${a.length} vs ${b.length}`);
  }
  let xor = BigInt("0x" + a) ^ BigInt("0x" + b);
  let count = 0;
  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }
  return count;
}
