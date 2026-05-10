// /health page. Pings the API every 5 seconds and renders one status card
// per subsystem so anyone debugging the stack can see at a glance which
// component is unhappy.
//
// We intentionally keep this independent of the WebSocket (which has its
// own card) so a broken WS doesn't make the health page itself look broken.

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import type { HealthCheck, HealthResponse } from "@argon/shared";
import { useAppSelector } from "../store";
import { useHealthQuery } from "../store/api";

const POLL_INTERVAL_MS = 5_000;

interface StatusCardProps {
  label: string;
  ok: boolean | null; // null = unknown / loading
  message: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
}

function StatusCard({ label, ok, message, latencyMs, detail }: StatusCardProps) {
  const color: "success" | "error" | "default" =
    ok === true ? "success" : ok === false ? "error" : "default";
  const Icon = ok === true ? CheckCircleIcon : ok === false ? ErrorOutlineIcon : HelpOutlineIcon;

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Icon
            color={ok === true ? "success" : ok === false ? "error" : "disabled"}
            fontSize="medium"
          />
          <Box>
            <Typography fontWeight={600}>{label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {message}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          {latencyMs !== undefined && (
            <Chip size="small" label={`${latencyMs}ms`} variant="outlined" />
          )}
          <Chip
            size="small"
            label={ok === true ? "Healthy" : ok === false ? "Down" : "Unknown"}
            color={color}
          />
        </Stack>
      </Stack>
      {detail && Object.keys(detail).length > 0 && (
        <Box
          component="pre"
          sx={{
            mt: 1.5,
            mb: 0,
            p: 1,
            backgroundColor: "grey.50",
            borderRadius: 1,
            fontSize: 12,
            overflow: "auto",
          }}
        >
          {JSON.stringify(detail, null, 2)}
        </Box>
      )}
    </Paper>
  );
}

// Maps an API HealthCheck onto the props StatusCard wants.
function backendCardProps(label: string, check: HealthCheck | undefined): StatusCardProps {
  if (!check) return { label, ok: null, message: "Waiting for response…" };
  return {
    label,
    ok: check.ok,
    message: check.message,
    latencyMs: check.latencyMs,
    detail: check.detail,
  };
}

export function HealthPage() {
  const wsStatus = useAppSelector((s) => s.connection.status);
  const { data, error, isLoading, isFetching, refetch } = useHealthQuery(undefined, {
    pollingInterval: POLL_INTERVAL_MS,
    // Refetch when the user returns to the tab so the page is fresh.
    refetchOnFocus: true,
  });

  const checks: HealthResponse["checks"] | undefined = data?.checks;

  return (
    <Box sx={{ minHeight: "100vh", py: 5, px: 3 }}>
      <Box sx={{ maxWidth: 720, mx: "auto" }}>
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
              System Health
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

        {data && (
          <Alert
            severity={data.status === "ok" ? "success" : "warning"}
            sx={{ mb: 2 }}
            variant="outlined"
          >
            Overall status: <strong>{data.status === "ok" ? "All systems operational" : "Degraded"}</strong>
            {" · last checked "}
            {new Date(data.timestamp).toLocaleTimeString()}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Couldn't reach the API. Make sure the backend is running on the URL configured in
            <code style={{ marginLeft: 4 }}>VITE_API_URL</code>.
          </Alert>
        )}

        <Stack spacing={1.5}>
          {/* The API check is implicit: if we got a response at all, the
              Express server is healthy. Showing it explicitly makes the page
              easy to read when something further down is broken. */}
          <StatusCard
            label="API server (Express)"
            ok={isLoading ? null : !error && !!data}
            message={
              isLoading
                ? "Pinging…"
                : error
                  ? "No response"
                  : `Reachable at ${import.meta.env.VITE_API_URL}`
            }
          />

          <StatusCard
            label="WebSocket (socket.io)"
            ok={wsStatus === "connected" ? true : wsStatus === "disconnected" ? false : null}
            message={
              wsStatus === "connected"
                ? "Receiving live image-status updates"
                : wsStatus === "connecting"
                  ? "Connecting / reconnecting…"
                  : "Disconnected — falling back to polling"
            }
          />

          <StatusCard {...backendCardProps("Database (Postgres)", checks?.database)} />
          <StatusCard {...backendCardProps("Job queue (Redis)", checks?.redis)} />
          <StatusCard {...backendCardProps("Validation worker", checks?.worker)} />
          <StatusCard {...backendCardProps("Object storage (S3)", checks?.s3)} />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>
          Polls every {POLL_INTERVAL_MS / 1000} seconds.
        </Typography>
      </Box>
    </Box>
  );
}
