import type { MiddlewareHandler } from "hono";

/**
 * Staff auth — owner: Dev 1. Placeholder until real auth lands.
 * DEMO_MODE=true lets judges use the workspace without accounts (submission checklist).
 */
export const requireStaff: MiddlewareHandler = async (c, next) => {
  if (process.env.DEMO_MODE === "true") {
    c.set("role" as never, (c.req.header("x-demo-role") ?? "treasurer") as never);
    return next();
  }
  // TODO(Dev 1): real session check.
  return c.json({ error: "Unauthorized" }, 401);
};
