// Local-only state for the upload queue. Each entry tracks one File from the
// moment the user drops it in until the API has acknowledged the /complete
// call. After that, the image lives entirely in the RTK Query cache.
//
// Why this is separate from server state: while a file is uploading we have
// no server resource to talk about - it's a local browser thing. Mixing it
// into RTK Query would mean inventing fake server records.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// State machine for a single upload attempt.
//   queued     -> the user dropped it, we haven't called /batch yet
//   presigning -> /batch is in flight
//   uploading  -> presigned PUT to S3 is in progress
//   completing -> /complete is in flight
//   done       -> finished. Remove from queue after a short delay.
//   failed     -> something blew up. Show an error and let the user retry.
export type UploadStatus =
  | "queued"
  | "presigning"
  | "uploading"
  | "completing"
  | "done"
  | "failed";

export interface UploadEntry {
  // Local UUID generated at drop time. Lets us key React lists before the
  // server has issued a real image id.
  localId: string;
  // What the user sees in the queue list.
  filename: string;
  sizeBytes: number;
  // Once /batch comes back, we link to the server-side image record.
  imageId: string | null;
  status: UploadStatus;
  // 0-100. Only meaningful while status === "uploading".
  progress: number;
  errorMessage?: string;
}

interface UploadQueueState {
  entries: Record<string, UploadEntry>;
  // Insertion order, kept separately so the UI can render in upload order
  // without sorting an object's values.
  order: string[];
}

const initialState: UploadQueueState = { entries: {}, order: [] };

const slice = createSlice({
  name: "uploadQueue",
  initialState,
  reducers: {
    addEntry(state, action: PayloadAction<UploadEntry>) {
      const entry = action.payload;
      state.entries[entry.localId] = entry;
      state.order.push(entry.localId);
    },
    setStatus(
      state,
      action: PayloadAction<{ localId: string; status: UploadStatus; errorMessage?: string }>,
    ) {
      const entry = state.entries[action.payload.localId];
      if (!entry) return;
      entry.status = action.payload.status;
      if (action.payload.errorMessage !== undefined) {
        entry.errorMessage = action.payload.errorMessage;
      }
    },
    setProgress(state, action: PayloadAction<{ localId: string; progress: number }>) {
      const entry = state.entries[action.payload.localId];
      if (entry) entry.progress = action.payload.progress;
    },
    setImageId(state, action: PayloadAction<{ localId: string; imageId: string }>) {
      const entry = state.entries[action.payload.localId];
      if (entry) entry.imageId = action.payload.imageId;
    },
    removeEntry(state, action: PayloadAction<{ localId: string }>) {
      delete state.entries[action.payload.localId];
      state.order = state.order.filter((id) => id !== action.payload.localId);
    },
    clearDone(state) {
      // Sweep finished/failed entries when the user dismisses them.
      for (const id of [...state.order]) {
        const entry = state.entries[id];
        if (entry && (entry.status === "done" || entry.status === "failed")) {
          delete state.entries[id];
          state.order = state.order.filter((x) => x !== id);
        }
      }
    },
  },
});

export const uploadQueueActions = slice.actions;
export const uploadQueueReducer = slice.reducer;
