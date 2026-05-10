// Activates background polling when the WebSocket is disconnected. The idea:
// when WS is healthy we never touch this; the moment it drops, we start a
// 5-second poll on the images list so the UI keeps refreshing. As soon as
// the socket reconnects we stop polling and let WS events take over again.

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { api } from "../store/api";

const POLL_INTERVAL_MS = 5_000;

export function usePollingFallback(): void {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.connection.status);

  useEffect(() => {
    if (status === "connected") return;

    // Disconnected or connecting. Refetch periodically until WS is back.
    const id = window.setInterval(() => {
      dispatch(api.util.invalidateTags([{ type: "Images", id: "LIST" }]));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, dispatch]);
}
