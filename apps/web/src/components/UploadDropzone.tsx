// The drag-and-drop area. Wraps react-dropzone with MUI styling so it matches
// the rest of the UI. On drop, runs client-side validation and forwards the
// good files to the upload coordinator.

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Box, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import { ALLOWED_MIME_TYPES, UI_LIMITS } from "@argon/shared";
import { useAppDispatch, useAppSelector } from "../store";
import { notificationsActions } from "../store/notifications-slice";
import { validateFileBeforeUpload } from "../services/client-validate";
import { uploadFiles } from "../services/upload";

interface Props {
  // True while at least one file is in-flight. Drives the "Uploading…" label
  // and the spinner overlay.
  isBusy: boolean;
}

// react-dropzone wants a record where keys are mime types and values are
// extension fallbacks for browsers that report empty types.
const ACCEPT_MAP = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
} as const;

export function UploadDropzone({ isBusy }: Props) {
  const dispatch = useAppDispatch();
  const acceptedCount = useAppSelector((s) =>
    Object.values(s.uploadQueue.entries).filter((e) => e.status === "done").length,
  );

  const remaining = Math.max(0, UI_LIMITS.maxImagesPerSession - acceptedCount);

  const onDrop = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      // Run client-side validation, accumulate the good files and surface
      // each rejection via a toast.
      const accepted: File[] = [];
      for (const file of files) {
        const result = validateFileBeforeUpload(file);
        if (!result.ok) {
          dispatch(
            notificationsActions.push({
              message: result.reason ?? "File rejected",
              severity: "warning",
            }),
          );
          continue;
        }
        accepted.push(file);
      }

      // Don't accept more than the per-session cap.
      const toUpload = accepted.slice(0, remaining);
      if (accepted.length > toUpload.length) {
        dispatch(
          notificationsActions.push({
            message: `You can upload up to ${UI_LIMITS.maxImagesPerSession} photos at a time. Extra files were skipped.`,
            severity: "info",
          }),
        );
      }
      if (toUpload.length === 0) return;
      void uploadFiles(toUpload, dispatch);
    },
    [dispatch, remaining],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT_MAP,
    multiple: true,
    // Some browsers report empty mime for HEIC; trust extensions in ACCEPT_MAP.
    maxSize: UI_LIMITS.maxFileSizeBytes,
    disabled: isBusy && remaining === 0,
  });

  return (
    <Paper
      {...getRootProps()}
      sx={{
        p: 4,
        textAlign: "center",
        cursor: "pointer",
        border: "2px dashed",
        borderColor: isDragActive ? "primary.main" : "grey.300",
        backgroundColor: isDragActive ? "primary.50" : "background.paper",
        transition: "border-color 0.15s, background-color 0.15s",
      }}
    >
      <input {...getInputProps()} />
      <Stack alignItems="center" spacing={1.5}>
        {isBusy ? (
          <CircularProgress size={28} />
        ) : (
          <CloudUploadOutlinedIcon sx={{ fontSize: 40, color: "grey.500" }} />
        )}
        <Box>
          <Typography fontWeight={600}>
            {isBusy ? "Uploading…" : "Click to upload or drag and drop"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            PNG, JPG, HEIC up to {Math.round(UI_LIMITS.maxFileSizeBytes / (1024 * 1024))}MB
          </Typography>
        </Box>
        {isBusy && (
          <Typography variant="caption" color="text.secondary">
            It can take up to a minute to upload
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

// Re-exported for callers that need to know the accepted mime list (e.g.
// to drive a hidden file input). Currently unused outside this file but
// good to keep alongside the dropzone definition.
export { ALLOWED_MIME_TYPES };
