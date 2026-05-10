// Tracks the WebSocket connection state. Used by the polling fallback to
// decide whether to poll, and by the UI to show a small "reconnecting"
// indicator if the connection drops.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface ConnectionState {
  status: ConnectionStatus;
  // Bumped whenever we receive a ping/event. Lets us detect "stale even if
  // socket says connected" though this is mostly a debugging signal.
  lastEventAt: number | null;
}

const initialState: ConnectionState = { status: "connecting", lastEventAt: null };

const slice = createSlice({
  name: "connection",
  initialState,
  reducers: {
    setStatus(state, action: PayloadAction<ConnectionStatus>) {
      state.status = action.payload;
    },
    bumpLastEventAt(state) {
      state.lastEventAt = Date.now();
    },
  },
});

export const connectionActions = slice.actions;
export const connectionReducer = slice.reducer;
