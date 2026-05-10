import ort from "onnxruntime-node";

const session = await ort.InferenceSession.create("./models/retinaface_mobile0.25.onnx");
console.log("Inputs:");
for (const name of session.inputNames) {
  console.log(" ", name);
}
console.log("Outputs:");
for (const name of session.outputNames) {
  console.log(" ", name);
}

const H = 640, W = 640;
const dummy = new Float32Array(1 * 3 * H * W).fill(0);
const feeds: Record<string, ort.Tensor> = {
  [session.inputNames[0]!]: new ort.Tensor("float32", dummy, [1, 3, H, W]),
};
const out = await session.run(feeds);
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k}: shape=${v.dims}`);
}
