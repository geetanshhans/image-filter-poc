// End-to-end load test for the Argon media pipeline.
//
// What it does, per image:
//   1. POST /api/uploads/batch  -> presigned PUT URL
//   2. PUT bytes to S3
//   3. POST /api/uploads/:id/complete  -> triggers validation -> pipeline
//   4. Poll GET /api/images/:id until pipelineStage = COMPLETE or FAILED
//
// Then it prints throughput, p50/p95/p99 end-to-end latency, status counts,
// and average per-stage durations.
//
// Why a real HTTP-driven script instead of k6: this is the only honest way to
// confirm the *whole* pipeline scales - upload + validation + 3 worker stages
// + DB + S3. Hitting just the API would test the wrong thing.
//
// Usage:
//   bun scripts/load-test.ts --count 100 --concurrency 20 --dir ./fixtures
//   bun scripts/load-test.ts --count 50 --concurrency 10 --api http://localhost:4000

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";

interface Args {
  count: number;
  concurrency: number;
  dir: string;
  api: string;
  pollIntervalMs: number;
  timeoutMs: number;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      count: { type: "string", default: "20" },
      concurrency: { type: "string", default: "5" },
      dir: { type: "string", default: "./fixtures" },
      api: { type: "string", default: "http://localhost:4000" },
      "poll-interval": { type: "string", default: "500" },
      timeout: { type: "string", default: "180000" },
    },
  });
  return {
    count: parseInt(values.count ?? "20", 10),
    concurrency: parseInt(values.concurrency ?? "5", 10),
    dir: values.dir ?? "./fixtures",
    api: (values.api ?? "http://localhost:4000").replace(/\/$/, ""),
    pollIntervalMs: parseInt(values["poll-interval"] ?? "500", 10),
    timeoutMs: parseInt(values.timeout ?? "180000", 10),
  };
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

interface Fixture {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

async function loadFixtures(dir: string): Promise<Fixture[]> {
  const entries = await readdir(dir);
  const fixtures: Fixture[] = [];
  for (const name of entries) {
    const ext = extname(name).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];
    if (!mimeType) continue;
    const bytes = await readFile(join(dir, name));
    fixtures.push({ name, bytes, mimeType });
  }
  if (fixtures.length === 0) {
    throw new Error(`No usable fixtures in ${dir}. Drop some .jpg/.png/.heic files there.`);
  }
  return fixtures;
}

interface Outcome {
  imageId: string;
  fixtureName: string;
  startedAt: number;
  completedAt: number;
  finalStage: string | null;
  finalStatus: string;
  pipelineError: string | null;
  // Per-stage durations in ms, derived from the timestamps the API exposes.
  // null when the stage didn't run (e.g. failed before reaching it).
  convertMs: number | null;
  compressMs: number | null;
  variantsMs: number | null;
  compressionRatio: number | null;
}

async function uploadOne(args: Args, fixture: Fixture): Promise<Outcome> {
  const startedAt = Date.now();

  // 1. Batch upload -> presigned URL.
  const batchRes = await fetch(`${args.api}/api/uploads/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: [{
        originalName: fixture.name,
        mimeType: fixture.mimeType,
        sizeBytes: fixture.bytes.length,
      }],
    }),
  });
  if (!batchRes.ok) {
    throw new Error(`batch failed: ${batchRes.status} ${await batchRes.text()}`);
  }
  const batchBody = (await batchRes.json()) as {
    items: Array<{ imageId: string; uploadUrl: string }>;
  };
  const { imageId, uploadUrl } = batchBody.items[0]!;

  // 2. PUT bytes to S3.
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": fixture.mimeType },
    body: fixture.bytes,
  });
  if (!putRes.ok) {
    throw new Error(`S3 PUT failed: ${putRes.status} ${await putRes.text()}`);
  }

  // 3. Complete -> kicks off validation -> pipeline.
  const completeRes = await fetch(`${args.api}/api/uploads/${imageId}/complete`, {
    method: "POST",
  });
  if (!completeRes.ok) {
    throw new Error(`complete failed: ${completeRes.status} ${await completeRes.text()}`);
  }

  // 4. Poll for terminal state.
  const deadline = startedAt + args.timeoutMs;
  let final: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, args.pollIntervalMs));
    const getRes = await fetch(`${args.api}/api/images/${imageId}`);
    if (!getRes.ok) continue;
    const { image } = (await getRes.json()) as { image: any };
    // REJECTED by validation = terminal too. So is FAILED in the pipeline.
    const stage = image.pipelineStage;
    if (image.status === "REJECTED" || stage === "COMPLETE" || stage === "FAILED") {
      final = image;
      break;
    }
  }
  const completedAt = Date.now();

  if (!final) {
    return {
      imageId,
      fixtureName: fixture.name,
      startedAt,
      completedAt,
      finalStage: null,
      finalStatus: "TIMEOUT",
      pipelineError: null,
      convertMs: null,
      compressMs: null,
      variantsMs: null,
      compressionRatio: null,
    };
  }

  // Per-stage durations from timestamps. createdAt -> convertedAt is the
  // queue+validate+convert time; convertedAt -> compressedAt is compress;
  // compressedAt -> completedAt is variants.
  const t = (v: string | null) => (v ? Date.parse(v) : null);
  const created = t(final.createdAt);
  // The DTO doesn't expose stage timestamps - we'd need to add them. For now
  // we measure only the end-to-end and use the createdAt baseline.
  return {
    imageId,
    fixtureName: fixture.name,
    startedAt,
    completedAt,
    finalStage: final.pipelineStage ?? null,
    finalStatus: final.status,
    pipelineError: final.pipelineError ?? null,
    convertMs: null,
    compressMs: null,
    variantsMs: null,
    compressionRatio: final.compressionRatio ?? null,
  };
}

// Pool that runs up to `limit` promises concurrently. Returns when all done.
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<Outcome>): Promise<Outcome[]> {
  const results: Outcome[] = [];
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) {
    workers.push((async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        try {
          const out = await fn(items[idx]!);
          results.push(out);
          process.stdout.write(".");
        } catch (err) {
          process.stdout.write("E");
          // Synthesize a failure outcome so the summary still reports it.
          results.push({
            imageId: "?",
            fixtureName: "?",
            startedAt: 0,
            completedAt: 0,
            finalStage: null,
            finalStatus: "ERROR",
            pipelineError: err instanceof Error ? err.message : String(err),
            convertMs: null,
            compressMs: null,
            variantsMs: null,
            compressionRatio: null,
          });
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function summarize(outcomes: Outcome[], wallMs: number, args: Args): void {
  console.log("\n\n=== Load Test Summary ===");
  console.log(`API:                ${args.api}`);
  console.log(`Requested:          ${args.count} images @ concurrency ${args.concurrency}`);
  console.log(`Wall time:          ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`Effective rate:     ${(outcomes.length / (wallMs / 1000)).toFixed(2)} img/s`);

  const byStatus: Record<string, number> = {};
  for (const o of outcomes) {
    const key = o.finalStatus === "ACCEPTED" ? `ACCEPTED:${o.finalStage}` : o.finalStatus;
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  console.log("\nOutcomes:");
  for (const [k, v] of Object.entries(byStatus).sort()) {
    console.log(`  ${k.padEnd(30)} ${v}`);
  }

  const completed = outcomes.filter(
    (o) => o.finalStage === "COMPLETE" && o.completedAt > 0,
  );
  const lat = completed.map((o) => o.completedAt - o.startedAt).sort((a, b) => a - b);
  if (lat.length > 0) {
    console.log("\nLatency (end-to-end, COMPLETE only):");
    console.log(`  min:  ${lat[0]} ms`);
    console.log(`  p50:  ${percentile(lat, 50)} ms`);
    console.log(`  p95:  ${percentile(lat, 95)} ms`);
    console.log(`  p99:  ${percentile(lat, 99)} ms`);
    console.log(`  max:  ${lat[lat.length - 1]} ms`);
  }

  const ratios = completed.map((o) => o.compressionRatio).filter((r): r is number => r != null);
  if (ratios.length > 0) {
    const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    console.log(`\nAvg compression ratio: ${avg.toFixed(3)} (${((1 - avg) * 100).toFixed(1)}% smaller)`);
  }

  const errors = outcomes.filter((o) => o.finalStatus === "ERROR" || o.finalStage === "FAILED");
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) {
      console.log(`  - ${e.fixtureName}: ${e.pipelineError ?? e.finalStatus}`);
    }
    if (errors.length > 10) console.log(`  ... and ${errors.length - 10} more`);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const fixtures = await loadFixtures(args.dir);
  console.log(`Loaded ${fixtures.length} fixtures from ${args.dir}`);
  console.log(`Submitting ${args.count} jobs @ concurrency ${args.concurrency} to ${args.api}`);

  // Use each fixture at most once. If count > fixtures, warn and cap.
  if (args.count > fixtures.length) {
    console.warn(
      `Warning: requested ${args.count} jobs but only ${fixtures.length} unique fixtures available. ` +
      `Capping at ${fixtures.length} to avoid uploading duplicates (which would be rejected by similarity check).`
    );
    args.count = fixtures.length;
  }
  // Shuffle so the order is randomised across runs.
  const shuffled = [...fixtures].sort(() => Math.random() - 0.5);
  const items = shuffled.slice(0, args.count);

  const t0 = Date.now();
  const outcomes = await runPool(items, args.concurrency, (f) => uploadOne(args, f));
  const wallMs = Date.now() - t0;

  summarize(outcomes, wallMs, args);
}

main().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
