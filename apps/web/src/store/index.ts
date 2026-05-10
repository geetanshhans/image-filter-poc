// Wires the Redux store together. Anywhere we need typed access to the store
// or dispatch, we import from this file (via the typed hooks below).

import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, type TypedUseSelectorHook } from "react-redux";
import { api } from "./api";
import { connectionReducer } from "./connection-slice";
import { notificationsReducer } from "./notifications-slice";
import { uploadQueueReducer } from "./upload-queue-slice";

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    uploadQueue: uploadQueueReducer,
    connection: connectionReducer,
    notifications: notificationsReducer,
  },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Typed hooks. Always import these instead of the raw react-redux hooks so
// selectors and dispatches benefit from type inference.
export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
