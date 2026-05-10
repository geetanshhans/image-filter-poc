// Standalone S3 credential test. Reads apps/api/.env and exercises every
// S3 operation the upload flow needs: put, get, delete. Prints clear
// per-step results so you can tell exactly which permission or credential
// is the problem.
//
// Run via: npx tsx scripts/test-s3.ts   (from apps/api)
//   or:    npm run test:s3              (from repo root, if wired up)

import { config as loadDotenv } from "dotenv";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

loadDotenv();

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucket = process.env.S3_BUCKET;

console.log("=== S3 credential check ===");
console.log(`AWS_REGION:           ${region}`);
console.log(`AWS_ACCESS_KEY_ID:    ${accessKeyId ? `${accessKeyId.slice(0, 4)}...${accessKeyId.slice(-4)} (${accessKeyId.length} chars)` : "MISSING"}`);
console.log(`AWS_SECRET_ACCESS_KEY: ${secretAccessKey ? `*** (${secretAccessKey.length} chars)` : "MISSING"}`);
console.log(`S3_BUCKET:            ${bucket}`);
console.log("");

if (!region || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("One or more required env vars are missing. Aborting.");
  process.exit(1);
}

// Whitespace is the most common mistake. Flag it explicitly.
if (accessKeyId !== accessKeyId.trim() || secretAccessKey !== secretAccessKey.trim()) {
  console.error("ERROR: leading/trailing whitespace in credentials.");
  console.error("  Open apps/api/.env and re-paste the values without quotes or spaces.");
  process.exit(1);
}

const client = new S3Client({
  region,
  credentials: { accessKeyId, secretAccessKey },
});

const probeKey = `argon/.healthcheck/${Date.now()}.txt`;
const probeBody = "argon-health-probe";

interface Step {
  name: string;
  run: () => Promise<unknown>;
}

const steps: Step[] = [
  {
    name: `PUT s3://${bucket}/${probeKey}`,
    run: () =>
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: probeKey,
          Body: probeBody,
          ContentType: "text/plain",
        }),
      ),
  },
  {
    name: `GET s3://${bucket}/${probeKey}`,
    run: () => client.send(new GetObjectCommand({ Bucket: bucket, Key: probeKey })),
  },
  {
    name: `DELETE s3://${bucket}/${probeKey}`,
    run: () => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: probeKey })),
  },
];

let allPassed = true;

for (const step of steps) {
  process.stdout.write(`-> ${step.name} ... `);
  const start = Date.now();
  try {
    await step.run();
    console.log(`OK (${Date.now() - start}ms)`);
  } catch (err) {
    allPassed = false;
    const e = err as {
      name?: string;
      message?: string;
      Code?: string;
      $metadata?: { httpStatusCode?: number; requestId?: string };
    };
    console.log("FAILED");
    console.log(`     name:        ${e.name}`);
    console.log(`     code:        ${e.Code ?? "(none)"}`);
    console.log(`     httpStatus:  ${e.$metadata?.httpStatusCode}`);
    console.log(`     requestId:   ${e.$metadata?.requestId}`);
    console.log(`     message:     ${e.message}`);

    // Hint mapping. Lifted from the health route so the script tells you
    // the same things the health page would.
    let hint = "";
    if (e.name === "InvalidAccessKeyId") {
      hint = "AWS_ACCESS_KEY_ID is wrong or has been deleted in AWS";
    } else if (e.name === "SignatureDoesNotMatch") {
      hint = "AWS_SECRET_ACCESS_KEY does not match the access key (re-paste from AWS console)";
    } else if (e.name === "PermanentRedirect" || e.$metadata?.httpStatusCode === 301) {
      hint = "AWS_REGION does not match the bucket's actual region";
    } else if (e.name === "NoSuchBucket" || e.$metadata?.httpStatusCode === 404) {
      hint = `bucket '${bucket}' does not exist in region '${region}'`;
    } else if (e.$metadata?.httpStatusCode === 403) {
      hint = "IAM user is missing the permission for this action";
    }
    if (hint) console.log(`     hint:        ${hint}`);

    // No reason to continue if the first step fails; later ones depend on it.
    break;
  }
}

console.log("");
if (allPassed) {
  console.log("All S3 operations succeeded. Credentials are good.");
  process.exit(0);
} else {
  console.log("S3 credential check failed. See errors above.");
  process.exit(1);
}
