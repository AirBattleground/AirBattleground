/** Studio link — a connected 7XEN Studio app (X-Studio-Key or X-Worker-Key = a Studio worker key; no cookies). Contract: shared/studioLink.ts. */
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { SCREENSHOT_KINDS, STUDIO_LINK_KEY_HEADER, studioLinkBroadcastSchema, studioLinkHeartbeatSchema } from "@7xen/shared";
import { isTest } from "../env.js";
import { AppError } from "../lib/errors.js";
import { parseMultipart, uploadedImages } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import * as link from "../services/studioLink.js";
import { workerByKey } from "../services/studioWorkers.js";
import { WORKER_KEY_HEADER } from "./studioWorker.js";

const kindSchema = z.object({
  kind: z.enum(SCREENSHOT_KINDS, { errorMap: () => ({ message: "Choose what the screenshot shows: team list or results" }) }),
});

async function studioOf(req: Request) {
  const worker = await workerByKey(req.get(STUDIO_LINK_KEY_HEADER) ?? req.get(WORKER_KEY_HEADER));
  if (!worker) throw new AppError("UNAUTHENTICATED", "Unknown studio key");
  await link.touch(worker);
  return worker;
}

const p = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function studioLinkRouter() {
  const r = Router();
  r.use(
    rateLimit({
      windowMs: 60_000,
      limit: isTest ? 10_000 : 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests from this studio. Wait a minute and try again." } });
      },
    }),
  );
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  r.get("/me", async (req, res) => {
    res.json(await link.me(await studioOf(req)));
  });
  r.get("/matches", async (req, res) => {
    res.json({ items: await link.matches(await studioOf(req)) });
  });
  r.get("/outputs", async (req, res) => {
    res.json(await link.outputs(await studioOf(req)));
  });
  r.post("/broadcasts", async (req, res) => {
    const worker = await studioOf(req);
    res.status(201).json(await link.startBroadcast(worker, parse(studioLinkBroadcastSchema, req.body ?? {})));
  });
  r.post("/broadcasts/:id/heartbeat", async (req, res) => {
    const worker = await studioOf(req);
    res.json(await link.heartbeat(worker, p(req.params.id), parse(studioLinkHeartbeatSchema, req.body ?? {})));
  });
  r.post("/broadcasts/:id/stop", async (req, res) => {
    await link.stopBroadcast(await studioOf(req), p(req.params.id));
    res.status(204).end();
  });
  r.post("/matches/:id/screenshots", async (req, res) => {
    const worker = await studioOf(req);
    await parseMultipart(req, res);
    const { kind } = parse(kindSchema, req.body);
    const images = uploadedImages(req, ["files", "files[]", "file"]);
    res.status(201).json(await link.screenshots(worker, p(req.params.id), kind, images));
  });
  return r;
}
