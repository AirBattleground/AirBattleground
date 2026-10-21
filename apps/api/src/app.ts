import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { Prisma } from "@prisma/client";
import { API_PREFIX, type ApiErrorBody } from "@7xen/shared";
import { env } from "./env.js";
import { AppError, OffsetMismatchError } from "./lib/errors.js";
import { logger } from "./logger.js";
import { adminRouter } from "./routes/admin.js";
import { adminAuthRouter, appAuthRouter } from "./routes/auth.js";
import { managerRouter } from "./routes/manager.js";
import { mediaRouter } from "./routes/media.js";
import { teamRouter } from "./routes/team.js";
import { playerRouter } from "./routes/player.js";
import { appReleaseRouter } from "./routes/appRelease.js";
import { internalStationRouter, liveRouter } from "./routes/station.js";
import { deviceRouter, internalMediaRouter } from "./routes/devices.js";
import { siteRouter } from "./routes/site.js";
import { studioWorkerRouter } from "./routes/studioWorker.js";
import { studioLinkRouter } from "./routes/studioLink.js";

/** Friendly message for a unique-constraint violation, based on the columns involved. */
/** Friendly message + the form field that clashed, so UIs can show the error in the right place. */
function uniqueError(err: Prisma.PrismaClientKnownRequestError): { message: string; fields?: Record<string, string> } {
  const target = err.meta?.target;
  const t = (Array.isArray(target) ? target.join(",") : String(target ?? "")).toLowerCase();
  if (t.includes("namekey")) {
    const message = "That team name is already taken";
    return { message, fields: { teamName: message } };
  }
  if (t.includes("username")) {
    const message = "That username is already taken";
    return { message, fields: { username: message } };
  }
  if (t.includes("email")) {
    const message = "That email is already used by another account";
    return { message, fields: { email: message } };
  }
  if (t.includes("bgmiid")) {
    const message = "This BGMI ID is already linked to another account";
    return { message, fields: { bgmiId: message } };
  }
  if (t.includes("slotnumber")) return { message: "That slot was just taken. Please try again." };
  if (t.includes("teamid")) return { message: "You're already registered for this scrim" };
  return { message: "That already exists" };
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { code: "INTERNAL", message: "Something went wrong" } };

  if (err instanceof OffsetMismatchError) {
    status = err.status;
    res.setHeader("Upload-Offset", String(err.offset));
    res.setHeader("Cache-Control", "no-store");
    body = { error: { code: err.code, message: err.message }, offset: err.offset } as ApiErrorBody;
  } else if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code as ApiErrorBody["error"]["code"], message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    status = 409;
    const { message, fields } = uniqueError(err);
    body = { error: { code: "CONFLICT", message, ...(fields ? { fields } : {}) } };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    status = 404;
    body = { error: { code: "NOT_FOUND", message: "Not found" } };
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    body = { error: { code: "VALIDATION_ERROR", message: "Request body isn't valid JSON" } };
  } else if (err?.type === "entity.too.large") {
    status = 413;
    body = { error: { code: "VALIDATION_ERROR", message: "Request is too large" } };
  } else {
    (req.log ?? logger).error({ err }, "unhandled error");
  }
  if (res.headersSent || res.destroyed) return; // e.g. a client that dropped mid-upload
  res.status(status).json(body);
};

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === `${API_PREFIX}/health` },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );

  app.get(`${API_PREFIX}/health`, (_req, res) => {
    res.json({ ok: true });
  });

  app.use(`${API_PREFIX}/auth`, appAuthRouter());
  app.use(`${API_PREFIX}/admin/auth`, adminAuthRouter());
  app.use(`${API_PREFIX}/admin`, adminRouter());
  app.use(`${API_PREFIX}/manager`, managerRouter());
  app.use(`${API_PREFIX}/team`, teamRouter());
  app.use(`${API_PREFIX}/player`, playerRouter());
  app.use(`${API_PREFIX}/media`, mediaRouter());
  app.use(`${API_PREFIX}/app`, appReleaseRouter());
  app.use(`${API_PREFIX}/site`, siteRouter());
  // phase 4b: AirBattleground Station live streams (viewer auth inside) + station → API hooks (X-Station-Token)
  app.use(`${API_PREFIX}/live`, liveRouter());
  app.use(`${API_PREFIX}/internal/station`, internalStationRouter());
  // phase 6: streaming phones (X-Device-Key)
  app.use(`${API_PREFIX}/device`, deviceRouter());
  app.use(`${API_PREFIX}/internal/media`, internalMediaRouter());
  // phase 8b: Studio workers (X-Worker-Key)
  app.use(`${API_PREFIX}/studio-worker`, studioWorkerRouter());
  // studio link: a connected 7XEN Studio app (X-Studio-Key)
  app.use(`${API_PREFIX}/studio-link`, studioLinkRouter());

  app.use((_req, res) => {
    const body: ApiErrorBody = { error: { code: "NOT_FOUND", message: "Not found" } };
    res.status(404).json(body);
  });
  app.use(errorHandler);
  return app;
}
