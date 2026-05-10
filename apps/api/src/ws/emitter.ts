// WebSocket event publisher. Both the API process and the worker process call
// these helpers, but only the API holds the socket.io Server (clients connect
// to it directly). To make worker-emitted events reach API-connected clients,
// we publish all events to a Redis pub/sub channel and the API subscribes to
// that channel on boot, re-emitting whatever it receives.
//
// Why pub/sub and not the socket.io Redis adapter: this app has one API
// process, so a full adapter is overkill. A 20-line bridge keeps the
// dependency footprint small and makes the data path obvious to a reader.

import type { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  ImageCreatedEventPayload,
  ImageDeletedEventPayload,
  ImageStatusEventPayload,
  ServerToClientEvents,
} from "@argon/shared";
import { WsEvent, type WsEventName } from "@argon/shared";
import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

type Io = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

// Channel name used by the Redis pub/sub bridge.
export const WS_BRIDGE_CHANNEL = "argon:ws:broadcast";

// Set by the API process at startup. Worker process never sets this.
let io: Io | null = null;
export function setIo(instance: Io): void {
  io = instance;
}

// Wire format on the bridge channel. Kept simple - just JSON.
interface BridgeMessage {
  event: WsEventName;
  payload: unknown;
}

// Publishes an event for clients to receive. In the API process this still
// goes through Redis - the API's own bridge subscriber will receive it back
// and call io.emit(). It's one extra hop, but it keeps the code path uniform
// regardless of which process called wsEmit.
async function publish(event: WsEventName, payload: unknown): Promise<void> {
  const message: BridgeMessage = { event, payload };
  try {
    await redis.publish(WS_BRIDGE_CHANNEL, JSON.stringify(message));
  } catch (err) {
    logger.warn("Failed to publish WS event", {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const wsEmit = {
  imageCreated(payload: ImageCreatedEventPayload): void {
    void publish(WsEvent.ImageCreated, payload);
  },
  imageStatus(payload: ImageStatusEventPayload): void {
    void publish(WsEvent.ImageStatus, payload);
  },
  imageDeleted(payload: ImageDeletedEventPayload): void {
    void publish(WsEvent.ImageDeleted, payload);
  },
};

// Called once by the API process at boot. Subscribes to the bridge channel
// and forwards every incoming event to all connected sockets.
export function startBridgeSubscriber(): void {
  if (!io) {
    throw new Error("setIo() must be called before startBridgeSubscriber()");
  }
  // Subscriber needs its own connection - a connection in subscribe mode
  // can't issue normal commands.
  const sub = redis.duplicate();
  sub.on("error", (err: Error) => logger.error("WS bridge subscriber error", { error: err.message }));
  sub.subscribe(WS_BRIDGE_CHANNEL).catch((err: Error) => {
    logger.error("Failed to subscribe to WS bridge channel", { error: err.message });
  });
  sub.on("message", (_channel: string, raw: string) => {
    try {
      const msg = JSON.parse(raw) as BridgeMessage;
      // Cast is safe because the wsEmit helpers above are the only callers
      // and they're typed against ServerToClientEvents.
      io?.emit(msg.event, msg.payload as never);
    } catch (err) {
      logger.warn("Failed to parse WS bridge message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  logger.info("WS bridge subscriber started", { channel: WS_BRIDGE_CHANNEL });
}
