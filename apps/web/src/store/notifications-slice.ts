// Centralized snackbar / toast queue. Components dispatch a notification and
// the root <NotificationHost /> renders it. Keeping it in Redux means any
// component (even non-React code paths like RTK Query error handlers) can
// surface a toast without prop-drilling a context.

import { createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";

export type NotificationSeverity = "success" | "info" | "warning" | "error";

export interface NotificationItem {
  id: string;
  message: string;
  severity: NotificationSeverity;
  // Optional auto-hide duration in ms. Defaults to 4000.
  durationMs?: number;
}

interface NotificationsState {
  items: NotificationItem[];
}

const initialState: NotificationsState = { items: [] };

const slice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    push: {
      // Prepare callback so we can generate the id inside the slice without
      // every call site having to do it.
      prepare(input: Omit<NotificationItem, "id">) {
        return { payload: { ...input, id: nanoid() } as NotificationItem };
      },
      reducer(state, action: PayloadAction<NotificationItem>) {
        state.items.push(action.payload);
      },
    },
    dismiss(state, action: PayloadAction<{ id: string }>) {
      state.items = state.items.filter((n) => n.id !== action.payload.id);
    },
  },
});

export const notificationsActions = slice.actions;
export const notificationsReducer = slice.reducer;
