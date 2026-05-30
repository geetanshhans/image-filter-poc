// Top app bar. Brand mark on the left, a thin gradient progress bar in the
// middle representing overall onboarding progress, close button on the right.
// We don't have multi-step onboarding here, so the progress bar fills as
// uploads finish - it's mostly aesthetic and matches the screenshot.

import { Box, Button, IconButton, LinearProgress, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import { UI_LIMITS } from "@argon/shared";

interface Props {
  acceptedCount: number;
}

export function TopBar({ acceptedCount }: Props) {
  const percent = Math.min(
    100,
    (acceptedCount / UI_LIMITS.recommendedMinImages) * 100,
  );

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={3}
      sx={{
        px: 3,
        py: 2,
        borderBottom: "1px solid",
        borderColor: "grey.200",
        backgroundColor: "background.paper",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #ff7043, #f4511e)",
          }}
        />
        <Typography fontWeight={700}>Argon.ai</Typography>
      </Stack>

      <Box sx={{ flex: 1 }}>
        <LinearProgress
          variant="determinate"
          value={percent}
          // Gradient bar - one of the few places we deviate from defaults
          // because the screenshots clearly show this gradient look.
          sx={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "grey.200",
            "& .MuiLinearProgress-bar": {
              background: "linear-gradient(90deg, #ff7043, #f4511e)",
              borderRadius: 3,
            },
          }}
        />
      </Box>

      <Button
        size="small"
        startIcon={<AccountTreeIcon />}
        onClick={() => {
          window.location.hash = "#/pipeline";
        }}
        sx={{ color: "text.secondary" }}
      >
        Pipeline
      </Button>

      <Button
        size="small"
        startIcon={<MonitorHeartIcon />}
        onClick={() => {
          window.location.hash = "#/health";
        }}
        sx={{ color: "text.secondary" }}
      >
        Health
      </Button>

      <IconButton size="small" aria-label="Close">
        <CloseIcon />
      </IconButton>
    </Stack>
  );
}
