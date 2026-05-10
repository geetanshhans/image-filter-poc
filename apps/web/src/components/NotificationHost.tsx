// Renders the toast queue from Redux. Each notification gets its own
// Snackbar so they stack rather than collapsing into one slot.

import { Alert, Snackbar } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../store";
import { notificationsActions } from "../store/notifications-slice";

export function NotificationHost() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.notifications.items);

  return (
    <>
      {items.map((n, i) => (
        <Snackbar
          key={n.id}
          open
          // Stack vertically by offsetting each one. Lets us have several
          // visible without using a portal/queue manager.
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          autoHideDuration={n.durationMs ?? 4000}
          onClose={() => dispatch(notificationsActions.dismiss({ id: n.id }))}
          sx={{ mb: i * 7 }}
        >
          <Alert
            severity={n.severity}
            onClose={() => dispatch(notificationsActions.dismiss({ id: n.id }))}
            variant="filled"
            sx={{ minWidth: 280 }}
          >
            {n.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
