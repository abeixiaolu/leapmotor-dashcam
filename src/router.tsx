import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import App from "./App";

const rootRoute = createRootRoute({ component: App });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const recordingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recordings/$recordingId",
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, recordingRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
