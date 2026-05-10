// Tiny chip in the corner showing whether we're getting live updates. Hidden
// when the WS is connected (the happy path doesn't need to be advertised);
// shows up only on disconnect/reconnecting so the user knows why updates
// might be delayed and that we're falling back to polling.

import { Chip, Stack } from "@mui/material";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import SyncIcon from "@mui/icons-material/Sync";
import { useAppSelector } from "../store";

export function ConnectionIndicator() {
  const status = useAppSelector((s) => s.connection.status);
  if (status === "connected") return null;

  return (
    <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
      <Chip
        size="small"
        icon={status === "connecting" ? <SyncIcon /> : <WifiOffIcon />}
        label={
          status === "connecting"
            ? "Reconnecting…"
            : "Live updates offline — refreshing every 5s"
        }
        color={status === "connecting" ? "warning" : "default"}
        variant="outlined"
      />
    </Stack>
  );
}
