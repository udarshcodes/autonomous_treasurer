import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requireStaff } from "./lib/auth";
import { commsRoutes } from "./routes/comms";
import { publicRoutes } from "./routes/public";
import { webhookRoutes } from "./routes/webhooks";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors({ origin: process.env.PUBLIC_APP_URL ?? "http://localhost:3000" }));

app.get("/health", (c) => c.json({ ok: true }));

// No auth: reached from links in emails and QR codes.
app.route("/public", publicRoutes);
app.route("/webhooks", webhookRoutes);

// Treasurer workspace. Owners add their route modules here:
//   TODO(Dev 1): ledger, events, budget lines, approvals inbox, execution
//   TODO(AI 1):  /agent (console, plan preview)
//   TODO(AI 2):  /sponsors (email extraction), /receipts (review)
//   TODO(AI 4):  /recon, /statement
app.use("/api/*", requireStaff);
app.route("/api", commsRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
