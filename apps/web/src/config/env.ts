// Frontend env access. We pull directly from import.meta.env once and re-export
// strongly-typed constants so the rest of the app doesn't have to know about
// Vite's env shape or worry about missing variables.

const API_URL = import.meta.env.VITE_API_URL;
const WS_URL = import.meta.env.VITE_WS_URL;

if (!API_URL) {
  throw new Error("Missing VITE_API_URL. Copy .env.example to .env in apps/web.");
}
if (!WS_URL) {
  throw new Error("Missing VITE_WS_URL. Copy .env.example to .env in apps/web.");
}

export const env = {
  apiUrl: API_URL as string,
  wsUrl: WS_URL as string,
} as const;
