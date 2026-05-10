// In-progress queue shown in the left panel. Each row is one file currently
// being uploaded or just finished. Once the server has accepted/rejected the
// image, it disappears from this list (it shows up in the right-side grid
// instead).

import {
  Box,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from "@mui/icons-material/Close";
import { useAppDispatch, useAppSelector } from "../store";
import { uploadQueueActions, type UploadEntry } from "../store/upload-queue-slice";

function StatusIcon({ entry }: { entry: UploadEntry }) {
  switch (entry.status) {
    case "done":
      return <CheckCircleIcon color="success" fontSize="small" />;
    case "failed":
      return <ErrorOutlineIcon color="error" fontSize="small" />;
    default:
      return <CircularProgress size={16} thickness={5} />;
  }
}

function statusLabel(entry: UploadEntry): string {
  switch (entry.status) {
    case "queued":
      return "Waiting…";
    case "presigning":
      return "Preparing…";
    case "uploading":
      return `Uploading ${entry.progress}%`;
    case "completing":
      return "Finalizing…";
    case "done":
      return "Uploaded";
    case "failed":
      return entry.errorMessage ?? "Failed";
  }
}

export function UploadQueueList() {
  const dispatch = useAppDispatch();
  const order = useAppSelector((s) => s.uploadQueue.order);
  const entries = useAppSelector((s) => s.uploadQueue.entries);

  if (order.length === 0) return null;

  return (
    <Stack spacing={1} sx={{ mt: 2 }}>
      {order.map((id) => {
        const entry = entries[id];
        if (!entry) return null;
        return (
          <Paper
            key={id}
            sx={{
              p: 1.25,
              display: "flex",
              alignItems: "center",
              gap: 1.25,
            }}
          >
            <ImageOutlinedIcon sx={{ color: "grey.500" }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                noWrap
                title={entry.filename}
                sx={{ fontWeight: 500 }}
              >
                {entry.filename}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {statusLabel(entry)}
              </Typography>
              {entry.status === "uploading" && (
                <LinearProgress
                  variant="determinate"
                  value={entry.progress}
                  sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
                />
              )}
            </Box>
            <Tooltip title={entry.status === "failed" ? entry.errorMessage ?? "Failed" : statusLabel(entry)}>
              <Box sx={{ display: "flex" }}>
                <StatusIcon entry={entry} />
              </Box>
            </Tooltip>
            {(entry.status === "done" || entry.status === "failed") && (
              <IconButton
                size="small"
                onClick={() => dispatch(uploadQueueActions.removeEntry({ localId: id }))}
                aria-label="Remove from queue"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
