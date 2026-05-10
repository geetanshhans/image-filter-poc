// WebSocket event names and payload shapes.
// The string literal types are exported so we don't pass raw strings around — typo-proof.

import type { ImageDto } from "./dto.js";

export const WsEvent = {
  // Server -> client: an image transitioned to a new state.
  // Sent on every status change (PROCESSING -> ACCEPTED/REJECTED).
  ImageStatus: "image:status",
  // Server -> client: a brand-new image was created (after the batch upload call).
  // Lets a second tab see uploads from another tab without polling.
  ImageCreated: "image:created",
  // Server -> client: an image was deleted.
  ImageDeleted: "image:deleted",
} as const;
export type WsEventName = (typeof WsEvent)[keyof typeof WsEvent];

export interface ImageStatusEventPayload {
  image: ImageDto;
}

export interface ImageCreatedEventPayload {
  image: ImageDto;
}

export interface ImageDeletedEventPayload {
  imageId: string;
}

// Type-safe event map used on both client and server.
export interface ServerToClientEvents {
  [WsEvent.ImageStatus]: (payload: ImageStatusEventPayload) => void;
  [WsEvent.ImageCreated]: (payload: ImageCreatedEventPayload) => void;
  [WsEvent.ImageDeleted]: (payload: ImageDeletedEventPayload) => void;
}

// No client -> server custom events for now. Heartbeat is socket.io's built-in
// ping/pong, which we don't need to wire ourselves.
export interface ClientToServerEvents {}
