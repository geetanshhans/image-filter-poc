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

  // AWS S3
  AWS_REGION: z.string().min(1, "AWS_REGION is required"),
  AWS_ACCESS_KEY_ID: z.string().min(1, "AWS_ACCESS_KEY_ID is required"),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, "AWS_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),

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
