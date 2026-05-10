# Argon Setup

End-to-end setup for running Argon locally. Estimated time: **15 minutes** (most of which is the AWS setup if you don't have a bucket already).

---

## 1. Prerequisites

Install these on your machine first:

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20 or higher | Runtime for the API and Vite dev server |
| npm | 10 or higher | Workspace support (ships with Node 20) |
| Docker Desktop | any recent | Runs Postgres + Redis in containers |

Verify:

```bash
node --version    # v20.x or higher
npm --version     # 10.x or higher
docker --version
docker compose version
```

If `docker compose version` fails, you have an older Docker - upgrade Docker Desktop.

---

## 2. AWS S3 Setup

You need: an AWS account, an S3 bucket with CORS configured, and an IAM user with scoped access.

### 2.1. Create the S3 bucket

1. Sign in to https://console.aws.amazon.com
2. Pick a region (top-right of the console). All steps must use the same region.
3. Go to **S3** → **Create bucket**
4. Bucket name: must be globally unique. Suggested: `argon-uploads-<your-initials>-<random>`
5. **Object Ownership**: leave default ("ACLs disabled (recommended)")
6. **Block Public Access**: leave **all four boxes checked** - we use presigned URLs, never public objects
7. **Bucket Versioning**: Disabled
8. **Default encryption**: leave on default
9. Click **Create bucket**

### 2.2. Configure CORS on the bucket

The browser uploads files directly to S3, so the bucket must allow cross-origin PUTs from `http://localhost:5173`.

1. Open the bucket → **Permissions** tab → scroll to **Cross-origin resource sharing (CORS)** → **Edit**
2. Paste this JSON exactly:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

3. Save changes.

### 2.3. Create an IAM user with scoped permissions

Don't use root credentials. Create a dedicated user limited to this bucket.

1. Go to **IAM** → **Users** → **Create user**
2. User name: `argon-uploads-app`
3. **Attach policies directly** → **Create policy** (opens in a new tab)
4. Switch to the **JSON** tab and paste this — **replace `YOUR-BUCKET-NAME` in both places**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketObjectAccess",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    },
    {
      "Sid": "AllowBucketListing",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

5. Name the policy `ArgonUploadsBucketAccess` and save it.
6. Go back to the user-creation tab, refresh the policy list, attach `ArgonUploadsBucketAccess`, finish creation.

### 2.4. Generate access keys

1. Click into `argon-uploads-app` → **Security credentials**
2. **Create access key** → use case: **Application running outside AWS**
3. Save the **Access key ID** and **Secret access key** somewhere safe — the secret is shown only once.

You should now have:

```
AWS_REGION=us-east-1                  # or whatever region you used
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=argon-uploads-...           # your bucket name
```

---

## 3. Clone, Install, Configure

### 3.1. Install dependencies

From the repo root:

```bash
npm install
```

This installs everything for `apps/api`, `apps/web`, and `packages/shared` because of npm workspaces. It will take a couple of minutes the first time (sharp + face-api + tfjs-node have native bindings).

> If `@tensorflow/tfjs-node` fails to compile on macOS, run `xcode-select --install` and try again.

### 3.2. Create the API `.env`

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` and fill in the four AWS values from step 2.4. Everything else can stay on the defaults.

### 3.3. Create the web `.env`

```bash
cp apps/web/.env.example apps/web/.env
```

The defaults (`VITE_API_URL=http://localhost:4000`) match step 4 below. No changes needed.

### 3.4. Start the infra (Postgres + Redis)

```bash
npm run infra:up
```

This brings up two Docker containers in the background. Verify with:

```bash
docker compose ps
```

You should see `argon-postgres` and `argon-redis` both `healthy`.

### 3.5. Run database migrations

```bash
npm run db:migrate
```

The first run will prompt you for a migration name — use `init`.

### 3.6. Download face detection models

```bash
npm run fetch-models
```

This downloads ~5MB of model weights into `apps/api/models/`. Only needed once.

---

## 4. Run the App

```bash
npm run dev
```

This starts three processes in parallel:

| Process | Port | What it does |
|---------|------|--------------|
| API | 4000 | REST + WebSocket server |
| Worker | (no port) | Pulls validation jobs off Redis Streams |
| Web | 5173 | Vite dev server |

Open **http://localhost:5173** and you should see the upload screen.

---

## 5. Verify Everything Works

A 60-second sanity check:

1. **Health endpoint**: `curl http://localhost:4000/api/health` → returns `{"status":"ok",...}`
2. **Drag a JPG into the dropzone** — it should appear in the in-progress queue, then move to the right-side grid as either Accepted or Rejected within a few seconds.
3. **Try a tiny file** (under 50KB) — it should be rejected with "File too small".
4. **Drag a HEIC** — should convert and display correctly.
5. **Drag the same image twice** — second one should be rejected with "Too similar to another upload".

If a file just sits at "Processing…" forever, the worker isn't running. Check the terminal output for `Worker ready, entering consume loop`.

---

## 6. Common Issues

**`Invalid environment variables` at API startup**
Missing or malformed `apps/api/.env`. The error message names the offending field.

**S3 PUT fails with `CORS preflight`**
You skipped step 2.2, or the `AllowedOrigins` list doesn't include the URL your browser is using.

**`face-api models not found`**
Run `npm run fetch-models` from the repo root.

**Worker logs `Could not connect to Redis`**
Run `npm run infra:up` and wait a few seconds for the containers to become healthy.

**Prisma errors mentioning `relation "Image" does not exist`**
Run `npm run db:migrate`.

**Everything works locally but Linux Docker installs of Sharp complain about libheif**
Add `--platform=linux/amd64` to the Postgres/Redis services if you're on Apple Silicon, or rebuild sharp with `npm rebuild sharp --workspace=@argon/api`.

---

## 7. Useful Commands

```bash
npm run dev                  # API + worker + web in parallel
npm run dev:api              # just the API
npm run dev:worker           # just the worker
npm run dev:web              # just the web app
npm run db:migrate           # apply new migrations
npm run db:reset             # nuke and re-create the DB (dev only)
npm run db:studio            # Prisma Studio - browse the DB visually
npm run infra:up             # start Postgres + Redis
npm run infra:down           # stop Postgres + Redis
npm run infra:logs           # tail Postgres + Redis logs
```

---

## 8. Tuning Validation Thresholds

All thresholds are env-driven. Edit `apps/api/.env` and restart the worker:

| Var | Default | Effect |
|-----|---------|--------|
| `MIN_FILE_SIZE_BYTES` | 51200 (50KB) | Files under this are rejected as too small |
| `MAX_FILE_SIZE_BYTES` | 26214400 (25MB) | Hard cap on accepted file size |
| `MIN_IMAGE_WIDTH` / `_HEIGHT` | 512 | Minimum image resolution |
| `BLUR_LAPLACIAN_THRESHOLD` | 100 | Lower = stricter blur check |
| `MIN_FACE_AREA_RATIO` | 0.05 | Face must occupy at least this fraction of the image |
| `SIMILARITY_HAMMING_THRESHOLD` | 5 | Higher = considers more images "similar" |
