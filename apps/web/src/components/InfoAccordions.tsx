// The "Photo Requirements" and "Photo Restrictions" collapsibles shown
// beneath the results grid. Static copy, here so the layout matches the
// screenshots and the user has somewhere to look up what makes a photo valid.

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import BlockIcon from "@mui/icons-material/Block";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const REQUIREMENTS = [
  "Sharp, well-lit photos with your face clearly visible",
  "JPG, PNG, or HEIC format",
  "At least 512×512 pixels",
  "A mix of close-ups, selfies, and mid-range shots",
];

const RESTRICTIONS = [
  "More than one person in the frame",
  "Blurry or out-of-focus shots",
  "Photos that look very similar to ones already uploaded",
  "Heavy filters, sunglasses, or anything covering your face",
];

export function InfoAccordions() {
  return (
    <Stack spacing={1.5} sx={{ mt: 3 }}>
      <Accordion disableGutters square sx={{ borderRadius: 1.5, overflow: "hidden" }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <CheckCircleOutlineIcon color="success" fontSize="small" />
            <Typography fontWeight={600}>Photo Requirements</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <List dense disablePadding>
            {REQUIREMENTS.map((item) => (
              <ListItem key={item} disableGutters>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "success.main",
                    }}
                  />
                </ListItemIcon>
                <ListItemText primary={item} primaryTypographyProps={{ variant: "body2" }} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      <Accordion disableGutters square sx={{ borderRadius: 1.5, overflow: "hidden" }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <BlockIcon color="error" fontSize="small" />
            <Typography fontWeight={600}>Photo Restrictions</Typography>
          </Stack>
        </AccordionSummary>
        <AccordionDetails>
          <List dense disablePadding>
            {RESTRICTIONS.map((item) => (
              <ListItem key={item} disableGutters>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "error.main",
                    }}
                  />
                </ListItemIcon>
                <ListItemText primary={item} primaryTypographyProps={{ variant: "body2" }} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>
    </Stack>
  );
}
