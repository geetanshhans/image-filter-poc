// 4-column grid of accepted thumbnails. We also include images still in
// PROCESSING here so the user sees something happening immediately - they
// get a slightly-faded thumbnail with a "Processing…" caption until the
// validator finishes.

import { Box, Paper } from "@mui/material";
import type { ImageDto } from "@argon/shared";
import { ImageCard } from "./ImageCard";

interface Props {
  images: ImageDto[];
}

export function AcceptedGrid({ images }: Props) {
  if (images.length === 0) return null;

  return (
    <Paper sx={{ p: 2, backgroundColor: "rgba(76, 175, 80, 0.04)" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 2,
        }}
      >
        {images.map((img) => (
          // Processing rows use the same variant; the card shows the
          // "Processing…" caption based on the image's status.
          <ImageCard key={img.id} image={img} variant="accepted" />
        ))}
      </Box>
    </Paper>
  );
}
