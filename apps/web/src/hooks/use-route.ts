// Tiny hash-based router. Three routes today (main, /health, /pipeline) -
// still small enough that a full router library would be overkill. Reading
// location.hash on every render plus listening for hashchange is enough.
//
// URLs look like:
//   http://localhost:5173/           -> main app
//   http://localhost:5173/#/health   -> health page
//   http://localhost:5173/#/pipeline -> pipeline dashboard

import { useEffect, useState } from "react";

export type Route = "main" | "health" | "pipeline";

function parse(hash: string): Route {
  if (hash === "#/health") return "health";
  if (hash === "#/pipeline") return "pipeline";
  return "main";
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
