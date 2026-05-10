// Two checks bundled together: file-size floor and resolution floor.
// We catch tiny files early so the more expensive face-detection step never
// runs on something that was going to be rejected anyway.

import { RejectionReason } from "@argon/shared";
import { env } from "../config/env.js";
import type { Validator } from "./types.js";

export const sizeValidator: Validator = {
  name: "size",
  run(ctx) {
    if (ctx.originalSizeBytes < env.MIN_FILE_SIZE_BYTES) {
      return {
        ok: false,
        reason: RejectionReason.SizeTooSmall,
        detail: `File is ${ctx.originalSizeBytes} bytes; minimum is ${env.MIN_FILE_SIZE_BYTES}`,
      };
    }
    if (ctx.width < env.MIN_IMAGE_WIDTH || ctx.height < env.MIN_IMAGE_HEIGHT) {
      return {
        ok: false,
        reason: RejectionReason.ResolutionTooSmall,
        detail: `Image is ${ctx.width}x${ctx.height}; minimum is ${env.MIN_IMAGE_WIDTH}x${env.MIN_IMAGE_HEIGHT}`,
      };
    }
    return { ok: true };
  },
};
