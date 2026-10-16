import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`7xen API listening on http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
