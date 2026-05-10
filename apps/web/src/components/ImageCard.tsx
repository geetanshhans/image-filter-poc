// One thumbnail card. Used by both the accepted-images grid and the rejected
// section, with a `variant` prop controlling subtle differences (the link
// under rejected images, the trash button on hover, etc.).
//
// Hover behavior is implemented with the MUI sx `:hover` pseudo so we don't
// need extra state and the markup stays simple.

import { Box, IconButton, Link, Paper, Tooltip, Typography } from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  ImageStatus,
  RejectionReasonHelp,
  RejectionReasonLabel,
  type ImageDto,
} from "@argon/shared";
import { useDeleteImageMutation } from "../store/api";
import { useAppDispatch } from "../store";
import { notificationsActions } from "../store/notifications-slice";

interface Props {
  image: ImageDto;
  // Accepted shows a clean thumbnail; rejected shows a faded thumbnail plus
  // the underlined reason link beneath.
  variant: "accepted" | "rejected";
}

export function ImageCard({ image, variant }: Props) {
  const dispatch = useAppDispatch();
  const [deleteImage, { isLoading: isDeleting }] = useDeleteImageMutation();

  async function handleDelete() {
    try {
      await deleteImage({ imageId: image.id }).unwrap();
    } catch {
      dispatch(
        notificationsActions.push({
          message: "Couldn't delete image. Please try again.",
          severity: "error",
        }),
      );
    }
  }

  return (
    <Box>
      <Paper
        sx={{
          position: "relative",
          aspectRatio: "1 / 1",
          overflow: "hidden",
          backgroundColor: "grey.100",
          // Reveal the trash button on hover.
          "&:hover .image-card__actions": { opacity: 1 },
        }}
      >
        {image.previewUrl ? (
          <Box
            component="img"
            src={image.previewUrl}
            alt={image.originalName}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: variant === "rejected" ? 0.7 : 1,
              display: "block",
            }}
            // If the presigned GET URL has expired (after env.S3_PRESIGN_EXPIRES_SECONDS)
            // we fall back to a neutral background. A refetch (via WS or polling)
            // will deliver a fresh URL.
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}

        <Box
          className="image-card__actions"
          sx={{
            position: "absolute",
            top: 6,
            right: 6,
            opacity: 0,
            transition: "opacity 0.15s",
          }}
        >
          <IconButton
            size="small"
            onClick={handleDelete}
            disabled={isDeleting}
            sx={{
              backgroundColor: "rgba(255, 255, 255, 0.9)",
              "&:hover": { backgroundColor: "white" },
            }}
            aria-label="Delete image"
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      </Paper>

      {variant === "rejected" && image.rejectionReason && (
        <Tooltip
          title={RejectionReasonHelp[image.rejectionReason]}
          placement="bottom"
          arrow
        >
          <Box sx={{ mt: 0.75, textAlign: "center" }}>
            <Link
              component="button"
              variant="caption"
              underline="always"
              color="text.primary"
              sx={{ fontWeight: 500 }}
            >
              {RejectionReasonLabel[image.rejectionReason]}
            </Link>
          </Box>
        </Tooltip>
      )}

      {variant === "accepted" && image.status === ImageStatus.Processing && (
        <Box sx={{ mt: 0.75, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary">
            Processing…
          </Typography>
        </Box>
      )}
    </Box>
  );
}
