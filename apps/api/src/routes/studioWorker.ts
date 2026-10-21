/** Phase 8b — Studio worker API (X-Worker-Key; no cookies). Contract: shared/studioWorker.ts. */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { workerPollSchema } from "@7xen/shared";
import { isTest } from "../env.js";
import { AppError } from "../lib/errors.js";
import { parse } from "../lib/validate.js";
import * as workers from "../services/studioWorkers.js";
import { signMobileToken } from "../lib/auth.js";
import { prisma } from "../db.js";

export const WORKER_KEY_HEADER = "X-Worker-Key";

export function studioWorkerRouter() {
  const r = Router();
  // a worker polls every ~2 s (30/min); allow headroom, stop key guessing
  r.use(
    rateLimit({
      windowMs: 60_000,
      limit: isTest ? 10_000 : 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests from this worker. Wait a minute and try again." } });
      },
    }),
  );
  r.post("/poll", async (req, res) => {
    const worker = await workers.workerByKey(req.get(WORKER_KEY_HEADER));
    if (!worker) throw new AppError("UNAUTHENTICATED", "Unknown worker key");
    res.setHeader("Cache-Control", "no-store");
    res.json(await workers.poll(worker, parse(workerPollSchema, req.body)));
  });
  // phase 8c: a Studio Box signs its Studio in as the box's manager with the key alone (no local login)
  r.post("/session", async (req, res) => {
    const worker = await workers.workerByKey(req.get(WORKER_KEY_HEADER));
    if (!worker) throw new AppError("UNAUTHENTICATED", "Unknown worker key");
    const manager = await prisma.user.findUniqueOrThrow({ where: { id: worker.managerId }, select: { id: true, displayName: true } });
    const { token, expiresAt } = signMobileToken({ sub: manager.id, role: "MANAGER" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ token, expiresAt: expiresAt.toISOString(), manager });
  });
  return r;
}
