// Attaches socket.io to an HTTP server and registers the singleton on the emitter.
// The default ping/pong behavior covers the "is the connection alive?" requirement
// without any extra code - clients see a `disconnect` event automatically when
// the heartbeat fails.

import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@argon/shared";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { setIo, startBridgeSubscriber } from "./emitter.js";

export function attachWebSocket(httpServer: HttpServer): void {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      cors: { origin: env.CORS_ORIGIN, credentials: true },
      // Defaults: pings every 25s, considers dead after 20s without a pong.
      // We keep the defaults - they're well-tuned for a typical browser client.
      pingInterval: 25_000,
      pingTimeout: 20_000,
    },
  );

  io.on("connection", (socket) => {
    logger.debug("WS client connected", { id: socket.id });
    socket.on("disconnect", (reason) => {
      logger.debug("WS client disconnected", { id: socket.id, reason });
    });
  });

  setIo(io);
  // Start bridging Redis pub/sub events into socket.io broadcasts so events
  // emitted by the worker process reach connected clients.
  startBridgeSubscriber();
}
