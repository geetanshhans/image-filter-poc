// Three rules folded into one validator since they all share the same
// face-detection result and we don't want to run the detector three times.
//
//   1. No faces  -> NO_FACE
//   2. >1 face   -> MULTIPLE_FACES
//   3. Face area below env.MIN_FACE_AREA_RATIO of total image -> FACE_TOO_SMALL

import { RejectionReason } from "@argon/shared";
import { env } from "../config/env.js";
import { detectFaces } from "../lib/face-api.js";
import type { Validator } from "./types.js";

export const faceValidator: Validator = {
  name: "face",
  async run(ctx) {
    const faces = await detectFaces(ctx.buffer);

    if (faces.length === 0) {
      return {
        ok: false,
        reason: RejectionReason.NoFace,
        detail: "No face detected by SSD MobileNet",
      };
    }

    if (faces.length > 1) {
      return {
        ok: false,
        reason: RejectionReason.MultipleFaces,
        detail: `Detected ${faces.length} faces`,
      };
    }

    // Single face. Check it occupies enough of the frame.
    const face = faces[0]!;
    const imageArea = ctx.width * ctx.height;
    const faceArea = face.width * face.height;
    const ratio = faceArea / imageArea;

    if (ratio < env.MIN_FACE_AREA_RATIO) {
      return {
        ok: false,
        reason: RejectionReason.FaceTooSmall,
        detail: `Face is ${(ratio * 100).toFixed(1)}% of image; minimum is ${(env.MIN_FACE_AREA_RATIO * 100).toFixed(1)}%`,
      };
    }

    return { ok: true };
  },
};
