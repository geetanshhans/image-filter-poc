// Deep health check. Each subsystem is probed in parallel and reported back
// individually so the frontend's /health page can show per-component status.
//
// We don't gate the response on overall status - even if Postgres is down we
// still return 200 with the per-check details. The frontend decides how to
// render mixed states. A simpler shallow probe lives at GET /api/health/ping
// for load-balancer use.

import { Router } from "express";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { redis, STREAMS } from "../lib/redis.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const healthRouter = Router();

interface CheckResult {
  ok: boolean;
  // Single-line description shown next to the status pill.
  message: string;
  // ms taken for the probe. Useful for spotting slow dependencies.
  latencyMs: number;
  // Optional structured detail we can render in expanded mode.
  detail?: Record<string, unknown>;
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const { latencyMs } = await timeIt(() => prisma.$queryRaw`SELECT 1`);
    // Also surface row count so the page can show "DB has N images".
    const total = await prisma.image.count();
    return {
      ok: true,
      message: `Postgres responding (${total} images)`,
      latencyMs,
      detail: { totalImages: total },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: 0,
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const { value, latencyMs } = await timeIt(() => redis.ping());
    return { ok: value === "PONG", message: `Redis ${value}`, latencyMs };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: 0,
    };
  }
}

// Pulls XINFO GROUPS to find out whether at least one worker is reading from
// the stream. Useful because the API can be perfectly healthy while no worker
// is processing - and that case manifests as images stuck on PROCESSING.
async function checkWorker(): Promise<CheckResult> {
  try {
    // XINFO GROUPS returns an array of arrays: each group is a flat key/value
    // list. We look up the consumers count for our group.
    const start = Date.now();
    const groups = (await redis.xinfo("GROUPS", STREAMS.validation)) as Array<unknown[]>;
    const latencyMs = Date.now() - start;

    let consumers = 0;
    let pending = 0;
    for (const flat of groups) {
      // flat looks like ["name", "validators", "consumers", N, "pending", N, ...]
      let name: string | null = null;
      for (let i = 0; i < flat.length; i += 2) {
        const k = flat[i];
        const v = flat[i + 1];
        if (k === "name") name = String(v);
        else if (k === "consumers" && name === STREAMS.validationGroup) consumers = Number(v);
        else if (k === "pending" && name === STREAMS.validationGroup) pending = Number(v);
      }
    }

    return {
      ok: consumers > 0,
      message:
        consumers > 0
          ? `${consumers} worker${consumers === 1 ? "" : "s"} connected (${pending} pending)`
          : "No workers connected to the validation stream",
      latencyMs,
      detail: { consumers, pending },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: 0,
    };
  }
}

// Tests the exact permissions the upload flow needs: PutObject and
// DeleteObject. We deliberately don't use HeadBucket because that requires
// s3:ListBucket which the app itself doesn't need - if we tested it, a
// strictly-scoped IAM user would show as unhealthy even when uploads work
// fine.
//
// The probe writes a 4-byte file under a hidden prefix and deletes it
// immediately. Negligible storage / cost, and any cleanup tooling will see
// the file as test traffic.
async function checkS3(): Promise<CheckResult> {
  const client = new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  // Unique key per probe so concurrent health checks don't fight each other.
  const probeKey = `argon/.healthcheck/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const start = Date.now();
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: probeKey,
        Body: "ok",
        ContentType: "text/plain",
      }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: probeKey }));
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      message: `Bucket ${env.S3_BUCKET} reachable in ${env.AWS_REGION} (put+delete OK)`,
      latencyMs,
    };
  } catch (err) {
    // The AWS SDK wraps real errors in opaque names like "UnknownError" -
    // the useful info lives on $metadata + name + message. Surface them all
    // so the health page tells the user exactly what went wrong (wrong
    // region, missing IAM permission, wrong bucket name, etc.).
    const e = err as {
      name?: string;
      message?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    const status = e.$metadata?.httpStatusCode;
    const name = e.name ?? "Error";
    const code = e.Code;
    const baseMessage = e.message || name;

    // Map the most common put/delete failures onto actionable hints.
    // Credential-related errors are checked BEFORE the 403 catch-all, since
    // SignatureDoesNotMatch comes back as a 403 but the cause is bad keys,
    // not missing IAM permissions.
    let hint = "";
    if (name === "InvalidAccessKeyId") {
      hint = ` - AWS_ACCESS_KEY_ID in .env is wrong or doesn't exist`;
    } else if (name === "SignatureDoesNotMatch") {
      hint = ` - AWS_SECRET_ACCESS_KEY in .env doesn't match the access key (check for stray whitespace)`;
    } else if (status === 301 || name === "PermanentRedirect") {
      hint = ` - check that AWS_REGION matches the bucket's actual region`;
    } else if (status === 404 || name === "NotFound" || name === "NoSuchBucket") {
      hint = ` - bucket does not exist (check S3_BUCKET in .env)`;
    } else if (status === 403 || name === "AccessDenied" || name === "Forbidden") {
      hint = ` - the IAM user is missing s3:PutObject or s3:DeleteObject on this bucket`;
    }

    return {
      ok: false,
      message: `${name}: ${baseMessage}${hint}`,
      latencyMs: 0,
      detail: {
        bucket: env.S3_BUCKET,
        region: env.AWS_REGION,
        httpStatus: status,
        errorName: name,
        errorCode: code,
        requestId: e.$metadata?.requestId,
      },
    };
  } finally {
    client.destroy();
  }
}

// Shallow ping for load balancers. Cheap, doesn't touch any dependency.
healthRouter.get("/ping", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Deep probe. Runs every check in parallel.
healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [database, redisCheck, worker, s3] = await Promise.all([
      checkDatabase(),
      checkRedis(),
      checkWorker(),
      checkS3(),
    ]);

    const overall = database.ok && redisCheck.ok && worker.ok && s3.ok;

    res.json({
      status: overall ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: { database, redis: redisCheck, worker, s3 },
    });
  }),
);
