// Single place that reads process.env. Anything that needs configuration imports
// from here, never from process.env directly. Validating with zod up front means
// the server fails to boot with a clear message if a required var is missing,
// instead of crashing on first use deep in some request handler.

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  // Server
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // AWS S3 / MinIO
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),
  // Optional: set to MinIO URL (e.g. http://localhost:9000) for local dev.
  // When set, the client uses path-style addressing (required by MinIO).
  S3_ENDPOINT: z.string().url().optional(),

  // Validation
  MIN_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(51200),
  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(26214400),
  MIN_IMAGE_WIDTH: z.coerce.number().int().positive().default(512),
  MIN_IMAGE_HEIGHT: z.coerce.number().int().positive().default(512),
  BLUR_LAPLACIAN_THRESHOLD: z.coerce.number().positive().default(100),
  MIN_FACE_AREA_RATIO: z.coerce.number().positive().max(1).default(0.05),
  SIMILARITY_HAMMING_THRESHOLD: z.coerce.number().int().nonnegative().default(5),

  // face-api
  FACE_API_MODELS_DIR: z.string().default("./models"),

  // ---------- Pipeline ----------
  // JPEG quality used by the compress stage. Lower = smaller files, more artifacts.
  // 82 with mozjpeg matches the typical "high quality web" sweet spot.
  COMPRESS_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(82),
  // Comma-separated widths in px for the variant stage, in thumbnail/web/full order.
  // Three values required; resize is width-only with aspect preserved.
  VARIANT_WIDTHS: z
    .string()
    .default("256,1280,2560")
    .transform((s) => s.split(",").map((n) => parseInt(n.trim(), 10)))
    .refine((arr) => arr.length === 3 && arr.every((n) => Number.isFinite(n) && n > 0), {
      message: "VARIANT_WIDTHS must be three positive integers (thumbnail,web,full)",
    }),
  // JPEG quality for resized variants. A touch higher than compress because
  // downsampling already removes detail and we want the small versions sharp.
  VARIANT_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(85),
  // Reconciler interval (ms). Scans for rows stuck in non-terminal pipeline
  // stages and re-enqueues them onto the appropriate stream.
  RECONCILER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  // Age threshold (ms) before the reconciler considers a row stuck. Must be
  // longer than the slowest stage's normal duration to avoid false positives.
  RECONCILER_STUCK_AFTER_MS: z.coerce.number().int().positive().default(300_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Print the validation issues clearly and exit. Trying to keep running with
  // bad config just produces confusing errors elsewhere.
  console.error("\n  Invalid environment variables:");
  for (const issue of parsed.error.issues) {
    console.error(`    - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\n  Copy .env.example to .env and fill in the values.\n");
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
