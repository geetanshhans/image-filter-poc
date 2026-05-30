// Status enums live here (not in Prisma) so the frontend can import them
// without pulling in the entire Prisma client.

export const ImageStatus = {
  PendingUpload: "PENDING_UPLOAD",
  Processing: "PROCESSING",
  Accepted: "ACCEPTED",
  Rejected: "REJECTED",
} as const;
export type ImageStatus = (typeof ImageStatus)[keyof typeof ImageStatus];

// Pipeline stages an ACCEPTED image moves through. Distinct from ImageStatus
// because validation and pipeline progress are independent concerns - an image
// is ACCEPTED once validation passes, then the pipelineStage tracks the rest.
export const PipelineStage = {
  Converting: "CONVERTING",
  Compressing: "COMPRESSING",
  GeneratingVariants: "GENERATING_VARIANTS",
  Complete: "COMPLETE",
  Failed: "FAILED",
} as const;
export type PipelineStage = (typeof PipelineStage)[keyof typeof PipelineStage];

export const RejectionReason = {
  SizeTooSmall: "SIZE_TOO_SMALL",
  ResolutionTooSmall: "RESOLUTION_TOO_SMALL",
  InvalidFormat: "INVALID_FORMAT",
  Blurry: "BLURRY",
  NoFace: "NO_FACE",
  MultipleFaces: "MULTIPLE_FACES",
  FaceTooSmall: "FACE_TOO_SMALL",
  TooSimilar: "TOO_SIMILAR",
  ProcessingError: "PROCESSING_ERROR",
} as const;
export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];

// Short labels shown directly on rejected image cards (the underlined link text).
export const RejectionReasonLabel: Record<RejectionReason, string> = {
  SIZE_TOO_SMALL: "File too small",
  RESOLUTION_TOO_SMALL: "Resolution too low",
  INVALID_FORMAT: "Unsupported format",
  BLURRY: "Blurry face detected",
  NO_FACE: "No face detected",
  MULTIPLE_FACES: "Multiple faces detected",
  FACE_TOO_SMALL: "Face is too far away",
  TOO_SIMILAR: "Too similar to another upload",
  PROCESSING_ERROR: "Couldn't process this image",
};

// Longer copy shown in the tooltip when the user clicks the rejection reason.
// Keeping this in shared means UX copy lives next to the enum that triggers it.
export const RejectionReasonHelp: Record<RejectionReason, string> = {
  SIZE_TOO_SMALL: "This file is below the minimum size. Upload a higher quality version of the photo.",
  RESOLUTION_TOO_SMALL: "This photo's resolution is below our minimum. Use a higher resolution image.",
  INVALID_FORMAT: "We only accept JPG, PNG, and HEIC photos.",
  BLURRY: "This photo isn't sharp enough. Make sure the camera is in focus and there's enough light.",
  NO_FACE: "We couldn't detect a face in this photo. Make sure your face is clearly visible.",
  MULTIPLE_FACES: "We detected more than one face. Upload a photo with only you in it.",
  FACE_TOO_SMALL: "Your face takes up too little of the frame. Try a closer shot.",
  TOO_SIMILAR:
    "You've already uploaded images similar to this photo. Try a diversity of photos with different backgrounds, lighting, and clothing.",
  PROCESSING_ERROR: "Something went wrong while processing this photo. Please try uploading it again.",
};
