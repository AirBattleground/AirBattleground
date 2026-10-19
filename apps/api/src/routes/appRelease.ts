/**
 * Phase 4: public download of the AirBattleground Manager APK.
 * The build drops the APK + `latest.json` ({ version, versionCode, file, notes, publishedAt }) into
 * <STORAGE_DIR>/apps/manager/.
 */
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import type { AppRelease } from "@7xen/shared";
import { notFound } from "../lib/errors.js";
import { storageRoot } from "../lib/storage.js";
import { logger } from "../logger.js";

const manifestSchema = z.object({
  version: z.string().min(1).max(40),
  versionCode: z.number().int().min(1),
  /** APK file name inside the same folder */
  file: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/),
  notes: z.string().max(5000).nullable().optional(),
  publishedAt: z.string().min(1),
});

const managerAppDir = () => path.join(storageRoot(), "apps", "manager");

async function latestManagerRelease(): Promise<{ release: AppRelease; abs: string } | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(managerAppDir(), "latest.json"), "utf8");
  } catch {
    return null;
  }
  let manifest: z.infer<typeof manifestSchema>;
  try {
    manifest = manifestSchema.parse(JSON.parse(raw));
  } catch (err) {
    logger.warn({ err }, "storage/apps/manager/latest.json is invalid");
    return null;
  }
  const abs = path.join(managerAppDir(), manifest.file);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return null;
    size = st.size;
  } catch {
    return null;
  }
  const publishedAt = new Date(manifest.publishedAt);
  return {
    abs,
    release: {
      version: manifest.version,
      versionCode: manifest.versionCode,
      url: "/api/app/manager/download",
      sizeBytes: size,
      notes: manifest.notes ?? null,
      publishedAt: Number.isNaN(publishedAt.getTime()) ? manifest.publishedAt : publishedAt.toISOString(),
    },
  };
}

export function appReleaseRouter() {
  const r = Router();
  r.get("/manager/latest", async (_req, res) => {
    const latest = await latestManagerRelease();
    res.setHeader("Cache-Control", "no-cache");
    res.json(latest?.release ?? null);
  });
  r.get("/manager/download", async (_req, res) => {
    const latest = await latestManagerRelease();
    if (!latest) throw notFound("The AirBattleground Manager app isn't available yet");
    const name = `airbattleground-manager-${latest.release.version.replace(/[^A-Za-z0-9._-]/g, "")}.apk`;
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Length", String(latest.release.sizeBytes));
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(latest.abs);
      stream.on("error", reject);
      res.on("finish", () => resolve());
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
    });
  });
  return r;
}
