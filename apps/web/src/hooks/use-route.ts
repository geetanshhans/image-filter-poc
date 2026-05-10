// Tiny hash-based router. We only have two routes (main and /health) so a
// full router library would be overkill. Reading location.hash on every
// render plus listening for hashchange is enough.
//
// URLs look like:
//   http://localhost:5173/         -> main app
//   http://localhost:5173/#/health -> health page

import { useEffect, useState } from "react";

export type Route = "main" | "health";

function parse(hash: string): Route {
  return hash === "#/health" ? "health" : "main";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const handler = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return route;
}
