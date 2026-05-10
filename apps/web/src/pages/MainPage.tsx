// Main upload screen. Two columns:
//   - Left:  intro copy, the dropzone, and the in-progress queue list
//   - Right: progress header, accepted grid, rejected section, info accordions
//
// Layout follows the reference screenshots: a single max-width container,
// generous padding, light background. We don't bother with responsive
// breakpoints below 900px - this is a desktop-first onboarding flow.

import { useMemo } from "react";
import { Box, Stack, Typography } from "@mui/material";
import FaceRetouchingNaturalIcon from "@mui/icons-material/FaceRetouchingNatural";
import { ImageStatus } from "@argon/shared";
import { TopBar } from "../components/TopBar";
import { UploadDropzone } from "../components/UploadDropzone";
import { UploadQueueList } from "../components/UploadQueueList";
import { UploadedImagesHeader } from "../components/UploadedImagesHeader";
import { AcceptedGrid } from "../components/AcceptedGrid";
import { RejectedSection } from "../components/RejectedSection";
import { InfoAccordions } from "../components/InfoAccordions";
import { ConnectionIndicator } from "../components/ConnectionIndicator";
import { useAppSelector } from "../store";
import { useListImagesQuery } from "../store/api";
import { usePollingFallback } from "../hooks/use-polling-fallback";
import { useUploadCompletionToast } from "../hooks/use-upload-completion-toast";

export function MainPage() {
  // The undefined arg matches the cache key the WS handler patches into,
  // so socket events update this exact subscription.
  const { data } = useListImagesQuery(undefined);

  // Background polling activates only when the WebSocket is offline.
  usePollingFallback();
  // Pops the success snackbar when the upload queue drains.
  useUploadCompletionToast();

  // Anything in PROCESSING / ACCEPTED goes in the top grid; REJECTED in its
  // own section. PENDING_UPLOAD only exists for a moment between batch and
  // /complete, so it gets grouped with PROCESSING.
  const { acceptedAndProcessing, rejected } = useMemo(() => {
    const all = data?.images ?? [];
    return {
      acceptedAndProcessing: all.filter(
        (i) =>
          i.status === ImageStatus.Accepted ||
          i.status === ImageStatus.Processing ||
          i.status === ImageStatus.PendingUpload,
      ),
      rejected: all.filter((i) => i.status === ImageStatus.Rejected),
    };
  }, [data]);

  const acceptedCount = useMemo(
    () => acceptedAndProcessing.filter((i) => i.status === ImageStatus.Accepted).length,
    [acceptedAndProcessing],
  );

  // Anything in the local queue that hasn't reached "done" or "failed" yet.
  const queueIsBusy = useAppSelector((s) =>
    s.uploadQueue.order.some((id) => {
      const e = s.uploadQueue.entries[id];
      return e && e.status !== "done" && e.status !== "failed";
    }),
  );

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TopBar acceptedCount={acceptedCount} />

      <Box sx={{ flex: 1, py: 5, px: 3 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={6}
          sx={{ maxWidth: 1200, mx: "auto" }}
        >
          {/* Left column - intro + dropzone + queue */}
          <Box sx={{ width: { xs: "100%", md: 340 }, flexShrink: 0 }}>
            <FaceRetouchingNaturalIcon sx={{ fontSize: 32, color: "primary.main", mb: 1 }} />
            <Typography variant="h5" fontWeight={700} sx={{ mb: 1 }}>
              Upload photos
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Now the fun begins! Select at least <strong>6 of your best photos</strong>.
              Uploading <strong>a mix of close-ups, selfies and mid-range shots</strong> can
              help the AI better capture your face and body type.
            </Typography>
            <UploadDropzone isBusy={queueIsBusy} />
            <UploadQueueList />
          </Box>

          {/* Right column - results */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <UploadedImagesHeader acceptedCount={acceptedCount} />
            <ConnectionIndicator />
            <Box sx={{ mt: 2 }}>
              <AcceptedGrid images={acceptedAndProcessing} />
            </Box>
            <RejectedSection images={rejected} acceptedCount={acceptedCount} />
            <InfoAccordions />
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
