// Root component. Picks which page to render from the URL hash and mounts
// the always-on notification host.

import { MainPage } from "./pages/MainPage";
import { HealthPage } from "./pages/HealthPage";
import { NotificationHost } from "./components/NotificationHost";
import { useRoute } from "./hooks/use-route";

export function App() {
  const route = useRoute();
  return (
    <>
      {route === "health" ? <HealthPage /> : <MainPage />}
      <NotificationHost />
    </>
  );
}
