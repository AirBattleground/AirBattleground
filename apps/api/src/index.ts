import { createApp } from "./app.js";
import { attachStationStream } from "./lib/stationStream.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { startScreenshotWorker } from "./services/screenshotWorker.js";
import { ensureDefaultRecipes } from "./services/recipes.js";
import { startRetentionSweeper } from "./services/recordings.js";
import { resumeOutputs, shutdownOutputs } from "./services/broadcast/compositor.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`AirBattleground API listening on http://localhost:${env.PORT}`);
});

attachStationStream(server); // live view/control WebSocket of the station's BlueStacks device

const stopWorker = env.SCREENSHOT_WORKER ? startScreenshotWorker() : () => {};
// phase 4: built-in recipe checklists + daily video retention sweep
void ensureDefaultRecipes().catch((err) => logger.error({ err }, "could not create the default recipes"));
const stopSweeper = startRetentionSweeper();
// phase 6b: broadcast outputs that were on before a restart come back by themselves
void resumeOutputs().catch((err) => logger.error({ err }, "could not resume broadcast outputs"));

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopWorker();
  stopSweeper();
  void shutdownOutputs();
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
