/**
 * Phase 6: Match Center "Capture team list / results" from a streaming iPhone → a screenshot in the match's reader
 * pipeline (same as an uploaded one, source DEVICE).
 *
 * Two sources, raced: (1) the phone itself — the request rides on its next heartbeat reply and it uploads a native
 * PNG (sharp, best for reading); (2) a frame grabbed from the live stream with ffmpeg (always works, lower quality).
 * We wait PHONE_WAIT_MS for the phone, then use the stream frame.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { DeviceCaptureResponse, ScreenshotKind, ScreenshotRow } from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { AppError, conflict } from "../lib/errors.js";
import { logger } from "../logger.js";
import { imageInfo, sha256 } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { devicePath, deviceStreamReady, internalCredentials } from "./media.js";
import { loadOwnMatch, toScreenshotRow, uploadScreenshots } from "./matches.js";

const PHONE_WAIT_MS = 4_500;
const GRAB_TIMEOUT_MS = 15_000;
const REQUEST_TTL_MS = 20_000;
const MAX_PNG_BYTES = 15 * 1024 * 1024;

// ---------------------------------------------------------------- phone snapshot requests

interface Pending {
  id: string;
  deviceId: string;
  at: number;
  sent: boolean;
  resolve: (png: Buffer | null) => void;
}
const pending = new Map<string, Pending>();

function sweep() {
  const now = Date.now();
  for (const p of pending.values()) {
    if (now - p.at > REQUEST_TTL_MS) {
      pending.delete(p.id);
      p.resolve(null);
    }
  }
}

/** Snapshot requests to hand the phone in its heartbeat reply (each is handed out once). */
export function takeSnapshotRequests(deviceId: string): { id: string }[] {
  sweep();
  const out: { id: string }[] = [];
  for (const p of pending.values()) {
    if (p.deviceId === deviceId && !p.sent) {
      p.sent = true;
      out.push({ id: p.id });
    }
  }
  return out;
}

/** The phone uploaded the PNG for a request. False when the request is unknown, expired, or not this device's. */
export function fulfilSnapshot(deviceId: string, requestId: string, png: Buffer): boolean {
  const p = pending.get(requestId);
  if (!p || p.deviceId !== deviceId) return false;
  pending.delete(requestId);
  p.resolve(png);
  return true;
}

function askPhone(deviceId: string, waitMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const id = randomUUID();
    // stop waiting and drop the request: a late answer must not be taken for a newer capture
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, waitMs);
    pending.set(id, {
      id,
      deviceId,
      at: Date.now(),
      sent: false,
      resolve: (png) => {
        clearTimeout(timer);
        resolve(png);
      },
    });
  });
}

// ---------------------------------------------------------------- stream frame

/** One PNG frame of the phone's live video, at its native size. */
function grabFrame(deviceId: string): Promise<Buffer | null> {
  const { user, pass } = internalCredentials();
  const src = `${env.MEDIA_RTMP_INTERNAL.replace(/\/+$/, "")}/${devicePath(deviceId)}?user=${user}&pass=${pass}`;
  return new Promise((resolve) => {
    const p = spawn(env.FFMPEG_PATH, ["-hide_banner", "-loglevel", "error", "-rw_timeout", "8000000", "-i", src, "-map", "0:v:0", "-frames:v", "1", "-f", "image2", "-c:v", "png", "pipe:1"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout!.on("data", (c: Buffer) => chunks.push(c));
    p.stderr!.on("data", (c: Buffer) => (err = (err + c.toString()).slice(-500)));
    const kill = setTimeout(() => p.kill("SIGKILL"), GRAB_TIMEOUT_MS);
    p.on("exit", (code) => {
      clearTimeout(kill);
      const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length) return resolve(buf);
      logger.warn({ deviceId, code, err }, "stream frame grab failed");
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------- capture

async function ingest(matchId: string, managerId: string, kind: ScreenshotKind, buf: Buffer): Promise<ScreenshotRow> {
  const info = imageInfo(buf);
  if (!info) throw new AppError("INTERNAL", "The captured image couldn't be read. Try again.", undefined, 502);
  const hash = sha256(buf);
  const img: UploadedImage = { buffer: buf, originalName: "device.png", info, sha256: hash };
  const { items } = await uploadScreenshots(matchId, managerId, kind, [img], false, "DEVICE");
  if (items[0]) return items[0];
  const again = await prisma.screenshot.findFirst({ where: { matchId, sha256: hash } });
  if (!again) throw new AppError("INTERNAL", "The screenshot couldn't be saved");
  return toScreenshotRow(again);
}

/** Capture the device's screen into a match the manager owns (device ownership is checked by the caller). */
export async function captureFromDevice(deviceId: string, managerId: string, matchId: string, kind: ScreenshotKind): Promise<DeviceCaptureResponse> {
  const m = await loadOwnMatch(matchId, managerId);
  if (m.status === "PUBLISHED") throw conflict("Results are published. Unpublish the match to add screenshots.");
  if (!(await deviceStreamReady(deviceId))) throw conflict("The iPhone isn't streaming. Start streaming on the phone, then capture.");

  const frame = grabFrame(deviceId); // starts now, used if the phone doesn't answer in time
  const phone = await askPhone(deviceId, PHONE_WAIT_MS);
  if (phone && phone.length <= MAX_PNG_BYTES && imageInfo(phone)) {
    void frame.catch(() => undefined);
    return { screenshot: await ingest(matchId, managerId, kind, phone), from: "PHONE" };
  }
  const buf = await frame;
  if (!buf) throw new AppError("INTERNAL", "Couldn't grab the picture from the stream. Try again in a moment.", undefined, 502);
  return { screenshot: await ingest(matchId, managerId, kind, buf), from: "STREAM" };
}
