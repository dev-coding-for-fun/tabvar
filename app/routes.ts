import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes({
  ignoredRouteFiles: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**"],
}) satisfies RouteConfig;
