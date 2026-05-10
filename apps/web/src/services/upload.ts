// Orchestrates the full upload journey for one file:
//
//   1. Add a queued entry to local Redux state so the UI shows it immediately.
//   2. POST /api/uploads/batch (one request per N files batched at the call site).
//   3. PUT bytes to the presigned S3 URL with progress events.
//   4. POST /api/uploads/:id/complete to enqueue validation.
//
// After step 4 the server takes over; status updates arrive via the WS layer.
//
// We use XMLHttpRequest (not fetch) for the S3 upload because fetch doesn't
// expose progress events for the request body. A 25MB phone photo can take
// 5+ seconds on a slow connection - the user needs to see something happening.

import { v4 as uuidv4 } from "uuid";
import type {
  BatchUploadRequest,
  BatchUploadResponse,
  CompleteUploadResponse,
} from "@argon/shared";
import { env } from "../config/env";
import type { AppDispatch } from "../store";
import { uploadQueueActions } from "../store/upload-queue-slice";
import { notificationsActions } from "../store/notifications-slice";

// Performs an XHR PUT and reports per-file progress via the callback.
// Returns a Promise that resolves on 2xx and rejects otherwise.
function putToS3(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    // S3 requires the Content-Type to match the type the URL was signed for.
    xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      onProgress(percent);
    };

    xhr.onload = () => {
      // S3 returns 200 for successful PUTs; any other status is an error.
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`S3 upload failed with status ${xhr.status}: ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error while uploading to S3"));
    xhr.onabort = () => reject(new Error("Upload aborted"));

    xhr.send(file);
  });
}

interface QueuedFile {
  localId: string;
  file: File;
}

// Public entry point. Accepts files validated client-side already; this
// function does the network work and dispatches Redux state along the way.
export async function uploadFiles(files: File[], dispatch: AppDispatch): Promise<void> {
  if (files.length === 0) return;

  // Step 1 - register everything as queued so the UI shows the rows.
  const queued: QueuedFile[] = files.map((file) => {
    const localId = uuidv4();
    dispatch(
      uploadQueueActions.addEntry({
        localId,
        filename: file.name,
        sizeBytes: file.size,
        imageId: null,
        status: "queued",
        progress: 0,
      }),
    );
    return { localId, file };
  });

  // Step 2 - one batch call for the whole drop. The server gives us back a
  // presigned URL per file, in the same order we sent them.
  for (const q of queued) {
    dispatch(uploadQueueActions.setStatus({ localId: q.localId, status: "presigning" }));
  }

  const batchBody: BatchUploadRequest = {
    files: queued.map((q) => ({
      originalName: q.file.name,
      mimeType: q.file.type || "application/octet-stream",
      sizeBytes: q.file.size,
    })),
  };

  let batch: BatchUploadResponse;
  try {
    const res = await fetch(`${env.apiUrl}/api/uploads/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batchBody),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Batch presign failed: ${res.status} ${detail}`);
    }
    batch = (await res.json()) as BatchUploadResponse;
  } catch (err) {
    // Whole batch failed - mark every entry as failed with the same message.
    const message = err instanceof Error ? err.message : String(err);
    for (const q of queued) {
      dispatch(
        uploadQueueActions.setStatus({
          localId: q.localId,
          status: "failed",
          errorMessage: message,
        }),
      );
    }
    dispatch(
      notificationsActions.push({
        message: "Couldn't start upload. Please try again.",
        severity: "error",
      }),
    );
    return;
  }

  // Step 3 + 4 - upload each file in parallel. Failures on one file don't
  // block the others.
  await Promise.all(
    queued.map(async (q, i) => {
      const item = batch.items.find((it) => it.index === i);
      if (!item) {
        dispatch(
          uploadQueueActions.setStatus({
            localId: q.localId,
            status: "failed",
            errorMessage: "Server did not return a presigned URL for this file",
          }),
        );
        return;
      }

      dispatch(uploadQueueActions.setImageId({ localId: q.localId, imageId: item.imageId }));
      dispatch(uploadQueueActions.setStatus({ localId: q.localId, status: "uploading" }));

      try {
        await putToS3(item.uploadUrl, q.file, (percent) => {
          dispatch(uploadQueueActions.setProgress({ localId: q.localId, progress: percent }));
        });
      } catch (err) {
        dispatch(
          uploadQueueActions.setStatus({
            localId: q.localId,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
          }),
        );
        return;
      }

      // Step 4 - tell the API we're done so it enqueues validation.
      dispatch(uploadQueueActions.setStatus({ localId: q.localId, status: "completing" }));
      try {
        const res = await fetch(`${env.apiUrl}/api/uploads/${item.imageId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Complete failed: ${res.status} ${text}`);
        }
        // The response body has the updated image; we don't need it because
        // the WS will deliver the status update too.
        (await res.json()) as CompleteUploadResponse;
        dispatch(uploadQueueActions.setStatus({ localId: q.localId, status: "done" }));
      } catch (err) {
        dispatch(
          uploadQueueActions.setStatus({
            localId: q.localId,
            status: "failed",
            errorMessage: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }),
  );
}
