import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// Dev-only e2e auth routes must never ship in a production bundle.
const devOnlyRouteFiles = process.env.NODE_ENV === "production" ? ["**/e2e.*"] : [];

export default flatRoutes({
  ignoredRouteFiles: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", ...devOnlyRouteFiles],
}) satisfies RouteConfig;
