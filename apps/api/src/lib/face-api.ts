// face-api setup. We feed image bytes directly to the SSD MobileNet detector
// as a TensorFlow tensor, no `canvas` polyfill required.
//
// Why this matters: node-canvas has a chain of native deps (cairo, pixman,
// pango) that need pkg-config and a working C toolchain to build. tfjs-node
// ships precompiled binaries, so this path Just Works on a vanilla Node
// install.
//
// loadFaceApi() is called once at worker boot to warm the model so the very
// first image doesn't pay the load cost in its critical path.

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as faceapi from "@vladmandic/face-api";
import * as tf from "@tensorflow/tfjs-node";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let initPromise: Promise<typeof faceapi> | null = null;

async function init(): Promise<typeof faceapi> {
  // Resolve the models directory relative to the API root regardless of CWD.
  // FACE_API_MODELS_DIR may be relative or absolute.
  const modelsDir = path.isAbsolute(env.FACE_API_MODELS_DIR)
    ? env.FACE_API_MODELS_DIR
    : path.resolve(__dirname, "../..", env.FACE_API_MODELS_DIR);

  logger.info("Loading face-api models", { modelsDir });
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
  logger.info("face-api models loaded");
  return faceapi;
}

// Idempotent loader. Concurrent callers reuse the same in-flight Promise so
// we don't trigger duplicate model loads.
export function loadFaceApi(): Promise<typeof faceapi> {
  if (!initPromise) initPromise = init();
  return initPromise;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

// Detects faces in a JPEG/PNG buffer and returns their bounding boxes.
// We dispose the tensor in a finally block - tfjs-node holds GPU/CPU memory
// that the GC won't reclaim, so leaking even one tensor per request adds up
// quickly under load.
export async function detectFaces(buffer: Buffer): Promise<FaceBox[]> {
  const fa = await loadFaceApi();
  // 3 channels = RGB (drops any alpha channel). expandAnimations=false keeps
  // a multi-frame GIF from being decoded as a 4D tensor face-api can't read.
  const tensor = tf.node.decodeImage(buffer, 3, undefined, false) as tf.Tensor3D;
  try {
    // The tensor type is what face-api expects in Node; the cast is needed
    // only because the lib's union types include browser-only HTMLImageElement.
    const detections = await fa.detectAllFaces(tensor as never);
    return detections.map((d) => ({
      x: d.box.x,
      y: d.box.y,
      width: d.box.width,
      height: d.box.height,
      score: d.score,
    }));
  } finally {
    tensor.dispose();
  }
}
