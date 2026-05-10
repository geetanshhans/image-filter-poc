# Argon

Bulk image uploader with face detection, blur detection, and near-duplicate checks. Uploaded photos are sorted into "Accepted" and "Rejected" sections in real time.

## What's inside

```
apps/
  api/        Node.js + Express + Prisma + socket.io
              Includes the validation worker (separate process)
  web/        React + Vite + MUI + Redux Toolkit + RTK Query
packages/
  shared/     TS types and constants used by both apps
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
