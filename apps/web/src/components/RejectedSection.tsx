// Rejected-images section. Mirrors the screenshot: collapsible header,
// reassurance subtitle when the user has hit the minimum, then a row of
// rejected cards with their reason underneath each.

import { useState } from "react";
import {
  Box,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { UI_LIMITS, type ImageDto } from "@argon/shared";
import { ImageCard } from "./ImageCard";

interface Props {
  images: ImageDto[];
  acceptedCount: number;
}

export function RejectedSection({ images, acceptedCount }: Props) {
  // Expanded by default when there are rejections - matches the screenshot
  // where this panel is open on first sight.
  const [expanded, setExpanded] = useState(true);

  if (images.length === 0) return null;

  const meetsMin = acceptedCount >= UI_LIMITS.recommendedMinImages;

  return (
    <Box
      sx={{
        mt: 3,
        p: 2,
        borderRadius: 1,
        backgroundColor: "rgba(255, 152, 0, 0.05)",
        border: "1px solid rgba(255, 152, 0, 0.2)",
      }}
    >
      <Stack
        direction="row"
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={1}
      >
        <Box>
          <Typography variant="subtitle1" fontWeight={600}>
            Some Photos Didn't Meet Our Guidelines
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {meetsMin
              ? `You can move to the next step as you've uploaded ${acceptedCount} good photos. Replacing these is optional.`
              : `Replace these photos to reach the recommended ${UI_LIMITS.recommendedMinImages} good photos.`}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse rejected section" : "Expand rejected section"}
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Stack>

      <Collapse in={expanded}>
        <Box
          sx={{
            mt: 2,
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 2,
          }}
        >
          {images.map((img) => (
            <ImageCard key={img.id} image={img} variant="rejected" />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
