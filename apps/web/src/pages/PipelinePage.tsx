// Pipeline dashboard. One row per image showing where it is in the
// convert -> compress -> generate-variants -> complete chain, plus a
// Reprocess action for rows that ended up FAILED.
//
// Data comes from the same listImages endpoint the main grid uses, so we
// share the cache and WebSocket invalidations - any image:status event
// auto-refreshes the row.

import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import { ImageStatus, PipelineStage, type ImageDto } from "@argon/shared";
import { useListImagesQuery, useReprocessImageMutation } from "../store/api";

// Background poll keeps the dashboard live even if a WS event is dropped.
// The main grid uses RTK Query's WebSocket invalidation; we add light polling
// here because someone watching this page is usually interested in *changes*.
const POLL_MS = 3_000;

// Color mapping for the stage chip. COMPLETE = success, FAILED = error,
// in-progress stages = info (so they all read the same way).
function chipColor(stage: ImageDto["pipelineStage"]): "success" | "error" | "info" | "default" {
  if (stage === PipelineStage.Complete) return "success";
  if (stage === PipelineStage.Failed) return "error";
  if (stage === null) return "default";
  return "info";
}

function stageLabel(image: ImageDto): string {
  // For rejected images, show why - they never entered the pipeline.
  if (image.status === ImageStatus.Rejected) return "REJECTED";
  if (image.status === ImageStatus.PendingUpload) return "PENDING UPLOAD";
  if (image.status === ImageStatus.Processing) return "VALIDATING";
  return image.pipelineStage ?? "—";
}

// Filter dropdown values. ALL = no filter, REJECTED uses status not stage.
type StageFilter = "ALL" | PipelineStage | "REJECTED";

export function PipelinePage() {
  const [filter, setFilter] = useState<StageFilter>("ALL");

  const { data, isLoading, isFetching, refetch, error } = useListImagesQuery(undefined, {
    pollingInterval: POLL_MS,
    refetchOnFocus: true,
  });

  const [reprocess, { isLoading: isReprocessing }] = useReprocessImageMutation();
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const images = data?.images ?? [];

  // Sort so failures bubble to the top, then in-progress stages, then complete,
  // then rejected. Within a bucket newest-first.
  const sorted = useMemo(() => {
    const rank = (img: ImageDto): number => {
      if (img.pipelineStage === PipelineStage.Failed) return 0;
      if (img.pipelineStage === PipelineStage.Converting) return 1;
      if (img.pipelineStage === PipelineStage.Compressing) return 2;
      if (img.pipelineStage === PipelineStage.GeneratingVariants) return 3;
      if (img.pipelineStage === PipelineStage.Complete) return 4;
      if (img.status === ImageStatus.Rejected) return 5;
      return 6;
    };
    return [...images].sort((a, b) => {
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [images]);

  const filtered = useMemo(() => {
    if (filter === "ALL") return sorted;
    if (filter === "REJECTED") return sorted.filter((i) => i.status === ImageStatus.Rejected);
    return sorted.filter((i) => i.pipelineStage === filter);
  }, [sorted, filter]);

  // Summary counters across the unfiltered set. Always shows the big picture
  // regardless of filter so you don't lose context.
  const counts = useMemo(() => {
    const c = { failed: 0, inProgress: 0, complete: 0, rejected: 0, other: 0 };
    for (const i of images) {
      if (i.pipelineStage === PipelineStage.Failed) c.failed++;
      else if (i.pipelineStage === PipelineStage.Complete) c.complete++;
      else if (i.pipelineStage) c.inProgress++;
      else if (i.status === ImageStatus.Rejected) c.rejected++;
      else c.other++;
    }
    return c;
  }, [images]);

  const onReprocess = async (id: string) => {
    setReprocessingId(id);
    try {
      await reprocess({ imageId: id }).unwrap();
    } catch (err) {
      // RTK Query surfaces the error in the mutation result; we don't snack
      // here because the row will re-render with whatever the server now says.
      console.error("Reprocess failed", err);
    } finally {
      setReprocessingId(null);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", py: 5, px: 3 }}>
      <Box sx={{ maxWidth: 1280, mx: "auto" }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Button
              size="small"
              startIcon={<ArrowBackIcon />}
              onClick={() => {
                window.location.hash = "";
              }}
            >
              Back
            </Button>
            <Typography variant="h5" fontWeight={700}>
              Pipeline Dashboard
            </Typography>
          </Stack>
          <Button
            size="small"
            startIcon={isFetching ? <CircularProgress size={14} /> : <RefreshIcon />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </Button>
        </Stack>

        {/* Live counters - quick read of system state without scanning the table. */}
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
          <Chip label={`Failed: ${counts.failed}`} color={counts.failed > 0 ? "error" : "default"} />
          <Chip label={`In progress: ${counts.inProgress}`} color="info" />
          <Chip label={`Complete: ${counts.complete}`} color="success" />
          <Chip label={`Rejected: ${counts.rejected}`} />
          <Box sx={{ flex: 1 }} />
          <Select
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value as StageFilter)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="ALL">All</MenuItem>
            <MenuItem value={PipelineStage.Failed}>Failed only</MenuItem>
            <MenuItem value={PipelineStage.Converting}>Converting</MenuItem>
            <MenuItem value={PipelineStage.Compressing}>Compressing</MenuItem>
            <MenuItem value={PipelineStage.GeneratingVariants}>Generating variants</MenuItem>
            <MenuItem value={PipelineStage.Complete}>Complete</MenuItem>
            <MenuItem value="REJECTED">Rejected (validation)</MenuItem>
          </Select>
        </Stack>

        {isLoading && <LinearProgress sx={{ mb: 2 }} />}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Couldn't fetch images. Is the API reachable?
          </Alert>
        )}

        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Preview</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell align="right">Original</TableCell>
                <TableCell align="right">Compressed</TableCell>
                <TableCell align="right">Ratio</TableCell>
                <TableCell>Notes</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                      No images match this filter yet. Upload some on the main page or change the filter.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((img) => {
                const isFailed = img.pipelineStage === PipelineStage.Failed;
                const note = isFailed
                  ? img.pipelineError
                  : img.status === ImageStatus.Rejected
                    ? img.rejectionReason
                    : null;
                const rowBusy = reprocessingId === img.id && isReprocessing;
                return (
                  <TableRow key={img.id} hover>
                    <TableCell>
                      {img.previewUrl ? (
                        <Box
                          component="img"
                          src={img.previewUrl}
                          alt=""
                          sx={{ width: 44, height: 44, objectFit: "cover", borderRadius: 1 }}
                        />
                      ) : (
                        <Box sx={{ width: 44, height: 44, bgcolor: "grey.200", borderRadius: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={img.id}>
                        <Typography variant="body2" sx={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {img.originalName}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={stageLabel(img)}
                        color={
                          img.status === ImageStatus.Rejected
                            ? "warning"
                            : chipColor(img.pipelineStage)
                        }
                        variant={img.pipelineStage === PipelineStage.Complete ? "filled" : "outlined"}
                      />
                    </TableCell>
                    <TableCell align="right">{formatBytes(img.sizeBytes)}</TableCell>
                    <TableCell align="right">
                      {img.compressedBytes != null ? formatBytes(img.compressedBytes) : "—"}
                    </TableCell>
                    <TableCell align="right">
                      {img.compressionRatio != null
                        ? `${(img.compressionRatio * 100).toFixed(1)}%`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {note ? (
                        <Tooltip title={note}>
                          <Typography
                            variant="caption"
                            color={isFailed ? "error" : "warning.main"}
                            sx={{
                              display: "block",
                              maxWidth: 280,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {note}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {isFailed ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="primary"
                          startIcon={rowBusy ? <CircularProgress size={14} /> : <ReplayIcon />}
                          disabled={rowBusy}
                          onClick={() => onReprocess(img.id)}
                        >
                          Reprocess
                        </Button>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
          Auto-refreshes every {POLL_MS / 1000}s. WebSocket events invalidate rows in real time.
        </Typography>
      </Box>
    </Box>
  );
}

// Compact byte formatter. Pipeline rows don't need exact bytes - KB/MB is plenty.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
