// Watches the upload queue and pops the "Your photos have been successfully
// uploaded!" toast once everything in the queue has finished (and at least
// one entry succeeded). Avoids firing on app load when the queue is empty.

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../store";
import { notificationsActions } from "../store/notifications-slice";
import { uploadQueueActions } from "../store/upload-queue-slice";

export function useUploadCompletionToast(): void {
  const dispatch = useAppDispatch();
  const entries = useAppSelector((s) => s.uploadQueue.entries);
  // Track previous "in-flight" count to detect the falling edge to zero.
  const prevInFlight = useRef(0);

  useEffect(() => {
    const list = Object.values(entries);
    const inFlight = list.filter(
      (e) => e.status !== "done" && e.status !== "failed",
    ).length;
    const succeeded = list.filter((e) => e.status === "done").length;

    if (prevInFlight.current > 0 && inFlight === 0 && succeeded > 0) {
      dispatch(
        notificationsActions.push({
          message: "Your photos have been successfully uploaded!",
          severity: "success",
        }),
      );
      // Clean up done/failed entries from the queue once the user has been
      // notified - the right-side grid is the source of truth from here on.
      dispatch(uploadQueueActions.clearDone());
    }
    prevInFlight.current = inFlight;
  }, [entries, dispatch]);
}
