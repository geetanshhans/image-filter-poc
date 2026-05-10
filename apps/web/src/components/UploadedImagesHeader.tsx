// The "Uploaded Images / X of 10" bar with the minimum-threshold marker.
// We compute the marker position as a percentage so the tick stays at the
// correct spot regardless of the bar's width.

import { Box, Stack, Tooltip, Typography } from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { UI_LIMITS } from "@argon/shared";

interface Props {
  acceptedCount: number;
}

export function UploadedImagesHeader({ acceptedCount }: Props) {
  const max = UI_LIMITS.maxImagesPerSession;
  const min = UI_LIMITS.recommendedMinImages;
  const fillPercent = Math.min(100, (acceptedCount / max) * 100);
  const markerPercent = (min / max) * 100;
  const meetsMin = acceptedCount >= min;

  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: "100%" }}>
      <Stack sx={{ flex: 1 }} spacing={0.75}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography variant="subtitle1" fontWeight={600}>
              Uploaded Images
            </Typography>
            <Tooltip title={`Upload at least ${min} of ${max} photos to continue. The marker shows the minimum.`} arrow>
              <HelpOutlineIcon fontSize="small" sx={{ color: "grey.500" }} />
            </Tooltip>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            <strong>{acceptedCount}</strong> of <strong>{max}</strong>
          </Typography>
        </Stack>

        <Box
          sx={{
            position: "relative",
            height: 6,
            borderRadius: 3,
            backgroundColor: "grey.200",
            overflow: "visible",
          }}
        >
          <Box
            sx={{
              height: "100%",
              width: `${fillPercent}%`,
              borderRadius: 3,
              backgroundColor: meetsMin ? "success.main" : "primary.main",
              transition: "width 0.3s ease",
            }}
          />
          {/* Tick mark for the recommended minimum. We draw it above the bar
              so it stays visible even when the fill is at 100%. */}
          <Box
            aria-label={`Minimum ${min} photos`}
            sx={{
              position: "absolute",
              top: -8,
              left: `${markerPercent}%`,
              transform: "translateX(-50%)",
              fontSize: 10,
              fontWeight: 700,
              color: meetsMin ? "success.main" : "text.secondary",
            }}
          >
            {min}
          </Box>
        </Box>
      </Stack>
    </Stack>
  );
}
