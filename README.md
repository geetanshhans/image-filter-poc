# Argon

Bulk image uploader with face detection, blur detection, and near-duplicate checks. Uploaded photos are sorted into "Accepted" and "Rejected" sections in real time, then accepted images flow through a three-stage media processing pipeline (convert → compress → generate variants) that's stateless and independently scalable.

## What's inside

```
apps/
  api/        Node.js + Express + Prisma + socket.io
              Plus 4 worker processes: validation, convert, compress, variants
  web/        React + Vite + MUI + Redux Toolkit + RTK Query
packages/
  shared/     TS types and constants used by both apps
scripts/
  load-test.ts        End-to-end load test (drives the real upload flow)
fixtures/             Drop sample images here for the load test
docker-compose.yml   Postgres + Redis for local development
SETUP.md             Full setup walkthrough (start here)
```

## Stack

- **Frontend**: React 18, MUI v6, Redux Toolkit, RTK Query, socket.io-client
- **Backend**: Express, Prisma, PostgreSQL, Redis Streams (consumer groups)
- **Storage**: AWS S3 (presigned PUT URLs - browser uploads directly)
- **Image processing**: sharp, @vladmandic/face-api (local, no cloud calls)
- **Real-time**: socket.io with built-in heartbeat, polling fallback when WS drops

## Quick start

See [SETUP.md](./SETUP.md) for the full walkthrough. The short version:

```bash
# 1. set up AWS S3 bucket + IAM user (see SETUP.md)
# 2. install + configure
npm install
cp apps/api/.env.example apps/api/.env  # fill in AWS values
cp apps/web/.env.example apps/web/.env
# 3. infra + db + models
npm run infra:up
npm run db:migrate
npm run fetch-models
# 4. run
npm run dev
```

Then open http://localhost:5173.

## How the upload flow works

```
Browser                           API                          S3                Worker
  |                                |                            |                  |
  |--- POST /uploads/batch ------->|                            |                  |
  |     (filenames + sizes)        |--- create DB rows -------->|                  |
  |<--- presigned PUT URLs --------|                            |                  |
  |                                                             |                  |
  |--- PUT bytes (parallel) ----------------------------------->|                  |
  |<------ 200 OK ----------------------------------------------|                  |
  |                                                                                |
  |--- POST /uploads/:id/complete -|                                               |
  |                                |--- XADD validation stream ------------------>|
  |<------ 200 OK -----------------|                                               |
  |                                                                                |
  |                                                                          download
  |                                                                                |
  |                                                                          run pipeline
  |                                                                          (size, blur,
  |                                                                           face, similarity)
  |                                                                                |
  |                                |<--- update DB ---------------------------------|
  |<==== WebSocket image:status ===|                                               |
```

## Validation rules

Each rule is a small pure function in `apps/api/src/validators/`. The pipeline runs them in order and stops at the first failure:

1. **Size** — file size in bytes, image resolution
2. **Format** — JPG/PNG/HEIC. HEIC is converted to JPEG before subsequent steps.
3. **Blur** — Laplacian variance below threshold = blurry
4. **Face** — exactly one face must be detected, occupying enough of the frame
5. **Similarity** — perceptual hash compared via Hamming distance against accepted images

All thresholds are env-overridable.

## Architecture choices worth flagging

- **Presigned URLs**, not multer/proxy uploads. The API never handles file bytes during upload, which is the only sane way to handle bulk concurrent uploads at scale.
- **Redis Streams** with `XREADGROUP` + `XAUTOCLAIM`, not BullMQ. We get ordered delivery, ack semantics, and pending-list recovery without a heavy abstraction. Dead-letter stream after 3 failed deliveries.
- **Worker as a separate process** so a slow image pipeline can't block HTTP requests and so workers scale independently of the API.
- **Pub/sub bridge for WS** — worker publishes to a Redis channel, API forwards to socket.io. Avoids running two socket.io servers.
- **Shared TS package** — backend and frontend import the same DTO types and event names, so a renamed field is a compile error on whichever side hasn't been updated.
- **Polling fallback** — when WebSocket disconnects, RTK Query starts polling every 5s. Fully transparent to the user.

## Processing pipeline (Part 2)

After validation marks an image `ACCEPTED`, it enters a 3-stage pipeline:

```
                  Redis Stream                Redis Stream             Redis Stream
ACCEPTED --enqueue--> argon:images:convert --> argon:images:compress --> argon:images:variants
                          |                          |                          |
                  [convert worker]          [compress worker]           [variants worker]
                  HEIC -> JPEG              mozjpeg quality=82          thumbnail/web/full
                  s3KeyProcessed             s3KeyCompressed            variants{} JSON
                                                                       pipelineStage=COMPLETE
```

Each stage:

- Runs in its **own process** (`dev:worker:convert`, `dev:worker:compress`, `dev:worker:variants`) reading from its **own Redis Stream + consumer group**. Scale convert independently of variants by running multiple instances of the slow stage's worker.
- Is **stateless** — no local disk, no in-process job memory. Anything horizontal-scale safe.
- Is **idempotent** — every handler checks `pipelineStage` before acting. Reprocessing the same `imageId` is a no-op once the stage has run; S3 writes use deterministic keys so a duplicate write produces the same bytes.

### Status surface

`GET /api/images/:id` returns:

```jsonc
{
  "image": {
    "status": "ACCEPTED",
    "pipelineStage": "COMPLETE",       // or CONVERTING/COMPRESSING/GENERATING_VARIANTS/FAILED
    "pipelineError": null,             // populated when FAILED
    "compressedBytes": 187234,
    "compressionRatio": 0.42,
    "variants": {
      "thumbnail": { "url": "https://...", "width": 256, "height": 384, "bytes": 12345 },
      "web":       { "url": "https://...", "width": 1280, "height": 1920, "bytes": 98765 },
      "full":      { "url": "https://...", "width": 2560, "height": 3840, "bytes": 234567 }
    }
  }
}
```

### Reprocessing

`POST /api/images/:id/reprocess` resets the pipeline state and re-enqueues onto `argon:images:convert`. Safe to call multiple times - the stage-handler idempotency guards make duplicate runs no-ops.

### Failure handling

- A stage handler catches its own errors and writes `pipelineStage = FAILED` + a user-facing `pipelineError` string. The message acks cleanly (no retry storm on a poisoned input).
- Transient infra errors (S3 blip, DB connection drop) bubble out of the handler; the harness leaves the message unacked. `XAUTOCLAIM` reclaims it; after 3 deliveries it hits the per-stage dead-letter stream.
- A **reconciler** runs inside the variants worker. Every 60s it scans for rows stuck in a non-terminal `pipelineStage` for >5 min (`updatedAt`) and re-enqueues them. This covers the gap where a stage updated the DB but crashed before enqueueing the next stage's message.

### Load test

Drop some images into `./fixtures/` first. The folder is git-ignored — populate it with your own photos, or use the one-liner in `fixtures/.gitkeep` to grab 15 AI-generated faces from `thispersondoesnotexist.com`:

```bash
for i in $(seq 1 15); do
  curl -s -L -o "fixtures/face-$(printf '%02d' $i).jpg" \
    https://thispersondoesnotexist.com/ -A "Mozilla/5.0"
  sleep 1
done
```

Then run:

```bash
# Default: 20 jobs at concurrency 5, against http://localhost:4000, fixtures in ./fixtures
npm run load-test

# Real run
npm run load-test -- --count 100 --concurrency 20 --dir ./fixtures
```

The script drives the full real upload flow: presign → S3 PUT → complete → poll until pipelineStage=COMPLETE or FAILED. It prints throughput, p50/p95/p99 end-to-end latency, status counts, and avg compression ratio.

### Scaling the slow stage

Variants is typically the slowest stage (three sharp resizes per image). To scale it:

```bash
# Run two extra variants workers alongside the default one
npm run dev:worker:variants &
npm run dev:worker:variants &
```

Re-run the load test - variants-stage throughput rises ~linearly with worker count until you saturate CPU or S3.
