// Bootstraps the React app. Mounts the Redux Provider, the MUI theme, and
// kicks off the WebSocket connection.

import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { App } from "./App";
import { store } from "./store";
import { theme } from "./theme";
import { initSocket } from "./services/socket";

initSocket(store);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </Provider>
  </React.StrictMode>,
);
