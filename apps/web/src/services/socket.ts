// WebSocket client that subscribes to image lifecycle events and patches the
// RTK Query cache so the UI reacts immediately. Setup happens once at app
// startup via initSocket(); the socket instance is held module-private.

import { io, type Socket } from "socket.io-client";
import {
  WsEvent,
  type ClientToServerEvents,
  type ImageCreatedEventPayload,
  type ImageDeletedEventPayload,
  type ImageStatusEventPayload,
  type ServerToClientEvents,
} from "@argon/shared";
import { env } from "../config/env";
import type { AppStore } from "../store";
import { api } from "../store/api";
import { connectionActions } from "../store/connection-slice";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

// Patches the listImages cache after each event so accepted/rejected/deleted
// transitions show up without a refetch. RTK Query's updateQueryData applies
// to whichever cached query the selector matches.
function applyImageUpdate(store: AppStore, image: ImageStatusEventPayload["image"]): void {
  store.dispatch(
    api.util.updateQueryData("listImages", undefined, (draft) => {
      const idx = draft.images.findIndex((i) => i.id === image.id);
      if (idx >= 0) {
        draft.images[idx] = image;
      } else {
        // New image - prepend to keep newest first.
        draft.images.unshift(image);
        draft.total += 1;
      }
    }),
  );
}

function applyImageDelete(store: AppStore, imageId: string): void {
  store.dispatch(
    api.util.updateQueryData("listImages", undefined, (draft) => {
      const idx = draft.images.findIndex((i) => i.id === imageId);
      if (idx >= 0) {
        draft.images.splice(idx, 1);
        draft.total = Math.max(0, draft.total - 1);
      }
    }),
  );
}

export function initSocket(store: AppStore): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (socket) return socket;

  socket = io(env.wsUrl, {
    // Reconnect forever with capped backoff. Default backoff is fine.
    reconnection: true,
    reconnectionDelayMax: 5_000,
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    store.dispatch(connectionActions.setStatus("connected"));
  });

  socket.on("disconnect", () => {
    store.dispatch(connectionActions.setStatus("disconnected"));
  });

  socket.io.on("reconnect_attempt", () => {
    store.dispatch(connectionActions.setStatus("connecting"));
  });

  socket.on(WsEvent.ImageCreated, (payload: ImageCreatedEventPayload) => {
    store.dispatch(connectionActions.bumpLastEventAt());
    applyImageUpdate(store, payload.image);
  });

  socket.on(WsEvent.ImageStatus, (payload: ImageStatusEventPayload) => {
    store.dispatch(connectionActions.bumpLastEventAt());
    applyImageUpdate(store, payload.image);
  });

  socket.on(WsEvent.ImageDeleted, (payload: ImageDeletedEventPayload) => {
    store.dispatch(connectionActions.bumpLastEventAt());
    applyImageDelete(store, payload.imageId);
  });

  return socket;
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
  return socket;
}
