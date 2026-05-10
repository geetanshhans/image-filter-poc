// One-time script that downloads face-api model weights into apps/api/models/.
// We host the URLs explicitly here rather than depending on the face-api
// package's bundled models (some versions ship them, some don't, behavior
// has shifted across releases).
//
// Run via: npm run fetch-models

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// We only use the SSD MobileNet face detector, so this is the minimum set.
// If we ever add expression/landmark detection, more weights go here.
const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model.bin",
];

const BASE_URL =
  "https://raw.githubusercontent.com/vladmandic/face-api/master/model";

const MODELS_DIR = path.resolve(__dirname, "..", "models");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(filename: string): Promise<void> {
  const url = `${BASE_URL}/${filename}`;
  const dest = path.join(MODELS_DIR, filename);

  if (await fileExists(dest)) {
    console.log(`  -> ${filename} already exists, skipping`);
    return;
  }

  console.log(`  -> downloading ${filename}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${filename}: HTTP ${response.status}`);
  }
  const arrayBuf = await response.arrayBuffer();
  await writeFile(dest, Buffer.from(arrayBuf));
}

async function main(): Promise<void> {
  await mkdir(MODELS_DIR, { recursive: true });
  console.log(`Fetching face-api models into ${MODELS_DIR}`);
  for (const file of FILES) {
    await downloadFile(file);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed to fetch models:", err);
  process.exit(1);
});
