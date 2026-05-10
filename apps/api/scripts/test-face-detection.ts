import ort from "onnxruntime-node";
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const MODEL_PATH = "./models/retinaface_mobile0.25.onnx";
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.5;
const NMS_IOU_THRESHOLD = 0.4;
const VARIANCE = [0.1, 0.2];

function generateAnchors(imgSize: number): number[][] {
  const steps = [8, 16, 32];
  const minSizes = [[16, 32], [64, 128], [256, 512]];
  const anchors: number[][] = [];
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s]!;
    const sizes = minSizes[s]!;
    const featH = Math.ceil(imgSize / step);
    const featW = Math.ceil(imgSize / step);
    for (let i = 0; i < featH; i++) {
      for (let j = 0; j < featW; j++) {
        for (const minSize of sizes) {
          const cx = (j + 0.5) / featW;
          const cy = (i + 0.5) / featH;
          const w = minSize / imgSize;
          const h = minSize / imgSize;
          anchors.push([cx, cy, w, h]);
        }
      }
    }
  }
  return anchors;
}

function decodeBboxes(locs: Float32Array, anchors: number[][]): number[][] {
  const boxes: number[][] = [];
  for (let i = 0; i < anchors.length; i++) {
    const [ax, ay, aw, ah] = anchors[i]!;
    const dx = locs[i * 4]!;
    const dy = locs[i * 4 + 1]!;
    const dw = locs[i * 4 + 2]!;
    const dh = locs[i * 4 + 3]!;
    const cx = ax! + dx * VARIANCE[0]! * aw!;
    const cy = ay! + dy * VARIANCE[0]! * ah!;
    const w  = aw! * Math.exp(dw * VARIANCE[1]!);
    const h  = ah! * Math.exp(dh * VARIANCE[1]!);
    boxes.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
  }
  return boxes;
}

function iou(a: number[], b: number[]): number {
  const ix1 = Math.max(a[0]!, b[0]!);
  const iy1 = Math.max(a[1]!, b[1]!);
  const ix2 = Math.min(a[2]!, b[2]!);
  const iy2 = Math.min(a[3]!, b[3]!);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const aArea = (a[2]! - a[0]!) * (a[3]! - a[1]!);
  const bArea = (b[2]! - b[0]!) * (b[3]! - b[1]!);
  return inter / (aArea + bArea - inter);
}

function nms(boxes: number[][], scores: number[], threshold: number): number[] {
  const order = scores
    .map((s, i) => [s, i] as [number, number])
    .sort((a, b) => b[0] - a[0])
    .map(([, i]) => i);
  const keep: number[] = [];
  const suppressed = new Uint8Array(scores.length);
  for (const i of order) {
    if (suppressed[i]) continue;
    keep.push(i);
    for (const j of order) {
      if (suppressed[j] || j === i) continue;
      if (iou(boxes[i]!, boxes[j]!) > threshold) suppressed[j] = 1;
    }
  }
  return keep;
}

let session: ort.InferenceSession | null = null;
let anchors: number[][] | null = null;

async function detectFaces(buffer: Buffer): Promise<Array<{
  x: number; y: number; width: number; height: number; score: number;
}>> {
  if (!session) session = await ort.InferenceSession.create(MODEL_PATH);
  if (!anchors) anchors = generateAnchors(INPUT_SIZE);

  const { data: raw } = await sharp(buffer)
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  const mean = [104, 117, 123];
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    tensor[0 * INPUT_SIZE * INPUT_SIZE + i] = (raw[i * 3 + 2]!) - mean[0]!; // B
    tensor[1 * INPUT_SIZE * INPUT_SIZE + i] = (raw[i * 3 + 1]!) - mean[1]!; // G
    tensor[2 * INPUT_SIZE * INPUT_SIZE + i] = (raw[i * 3 + 0]!) - mean[2]!; // R
  }

  const feeds = { input: new ort.Tensor("float32", tensor, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
  const results = await session.run(feeds);

  const locs  = results["loc"]!.data  as Float32Array;
  const confs = results["conf"]!.data as Float32Array;

  const scores: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    scores.push(confs[i * 2 + 1]!);
  }

  const boxes = decodeBboxes(locs, anchors);

  const confMask = scores.map((s, i) => s >= CONF_THRESHOLD ? i : -1).filter(i => i !== -1);
  const filtBoxes = confMask.map(i => boxes[i]!);
  const filtScores = confMask.map(i => scores[i]!);
  const kept = nms(filtBoxes, filtScores, NMS_IOU_THRESHOLD);

  const meta = await sharp(buffer).metadata();
  const origW = meta.width ?? INPUT_SIZE;
  const origH = meta.height ?? INPUT_SIZE;

  return kept.map(k => {
    const [x1, y1, x2, y2] = filtBoxes[k]!;
    return {
      score: filtScores[k]!,
      x: Math.round(x1! * origW),
      y: Math.round(y1! * origH),
      width:  Math.round((x2! - x1!) * origW),
      height: Math.round((y2! - y1!) * origH),
    };
  }).sort((a, b) => b.score - a.score);
}

// ── Update these paths to your own test images ───────────────────────────────
const images = [
  "/path/to/solo-portrait.jpg",       // expect: 1 face
  "/path/to/two-person-photo.jpg",    // expect: 2 faces
];

for (const imgPath of images) {
  const buf = await readFile(imgPath);
  const name = imgPath.split("/").at(-1);
  const meta = await sharp(buf).metadata();
  const faces = await detectFaces(buf);
  console.log(`\n${name}`);
  console.log(`  image: ${meta.width}x${meta.height}`);
  console.log(`  faces detected: ${faces.length}`);
  for (const f of faces) {
    const area = (f.width * f.height) / (meta.width! * meta.height!);
    console.log(`  -> score=${f.score.toFixed(3)}  box=${f.x},${f.y} ${f.width}x${f.height}  area=${(area*100).toFixed(1)}%`);
  }
}
