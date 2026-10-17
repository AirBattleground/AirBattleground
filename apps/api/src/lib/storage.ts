/**
 * File storage for screenshots and training images (phase 2).
 *
 * Files live under STORAGE_DIR (default <repo>/storage) and are addressed by a *storage key*: a
 * relative POSIX path such as "screenshots/2026/10/<id>.jpg". The extractor service reads the same
 * directory, so keys are what we send it. Keys are validated so a request can never escape the root.
 *
 * Deliberately independent of env.ts so prisma/seed.ts can use it too.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import { AppError, notFound } from "./errors.js";

// ---------------------------------------------------------------- root

function findRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let cachedRoot: string | null = null;
/** Absolute storage root. Reads STORAGE_DIR lazily so tests can point it at a temp dir. */
export function storageRoot(): string {
  if (cachedRoot) return cachedRoot;
  const fromEnv = process.env.STORAGE_DIR?.trim();
  cachedRoot = fromEnv
    ? path.resolve(fromEnv)
    : path.join(findRepoRoot(process.cwd()) ?? process.cwd(), "storage");
  return cachedRoot;
}

/** Testing hook: forget the cached root (after changing STORAGE_DIR). */
export function resetStorageRootCache() {
  cachedRoot = null;
}

const KEY_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/;

/** Resolve a storage key to an absolute path inside the root, or throw. Blocks traversal. */
export function resolveKey(key: string): string {
  return resolveUnder(storageRoot(), key);
}

/** Resolve `key` inside `root` (absolute), or throw. Blocks traversal. */
export function resolveUnder(root: string, key: string): string {
  if (
    typeof key !== "string" ||
    !key ||
    key.length > 300 ||
    !KEY_RE.test(key) ||
    key.split("/").some((seg) => seg === "." || seg === ".." || seg.startsWith("."))
  ) {
    throw new AppError("VALIDATION_ERROR", "Invalid file path");
  }
  const abs = path.resolve(root, key);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new AppError("VALIDATION_ERROR", "Invalid file path");
  return abs;
}

// ---------------------------------------------------------------- image sniffing

export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export const EXT_BY_MIME: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export interface ImageInfo {
  mime: ImageMime;
  ext: string;
  width: number | null;
  height: number | null;
}

/** Detect PNG/JPEG/WebP from magic bytes (never trust the client's mimetype). */
export function sniffImageType(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function pngSize(buf: Buffer) {
  // IHDR is always the first chunk: width/height at bytes 16..24
  if (buf.length < 24 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf: Buffer) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    // standalone markers without a length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf: Buffer) {
  if (buf.length < 30) return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 ") {
    // keyframe start code 9d 01 2a at 23..25
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  return null;
}

/** Type + pixel size from the header bytes, or null when it isn't a PNG/JPEG/WebP. */
export function imageInfo(buf: Buffer): ImageInfo | null {
  const mime = sniffImageType(buf);
  if (!mime) return null;
  const size = mime === "image/png" ? pngSize(buf) : mime === "image/jpeg" ? jpegSize(buf) : webpSize(buf);
  return { mime, ext: EXT_BY_MIME[mime], width: size?.width ?? null, height: size?.height ?? null };
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/** 0..99 bucket from a sha256 hex string; stable TRAIN/TEST split (70/30). */
export const splitForSha = (sha: string): "TRAIN" | "TEST" => (parseInt(sha.slice(0, 8), 16) % 100 < 70 ? "TRAIN" : "TEST");

// ---------------------------------------------------------------- read / write

export const newFileId = () => randomUUID().replace(/-/g, "");

/** "screenshots/2026/10/<id>.jpg" */
export function datedKey(area: "screenshots" | "samples", id: string, ext: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${area}/${y}/${m}/${id}.${ext}`;
}

/** Atomically write a buffer at `key` (temp file + rename). */
export async function saveBuffer(key: string, buf: Buffer): Promise<void> {
  const abs = resolveKey(key);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${newFileId()}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, abs);
}

export async function readBuffer(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function copyKey(fromKey: string, toKey: string): Promise<void> {
  const to = resolveKey(toKey);
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(resolveKey(fromKey), to);
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    return (await stat(resolveKey(key))).isFile();
  } catch {
    return false;
  }
}

/** Best-effort delete; missing files are fine. */
export async function deleteKey(key: string): Promise<void> {
  try {
    await unlink(resolveKey(key));
  } catch {
    /* ignore */
  }
}

/** Stream a stored file as the response with the right content type. 404 if missing. */
export async function sendStoredFile(res: Response, key: string, mime: string): Promise<void> {
  const abs = resolveKey(key);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    throw notFound("Image not found");
  }
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(abs);
    stream.on("error", reject);
    res.on("finish", () => resolve());
    res.on("close", () => resolve());
    stream.pipe(res);
  });
}

/** Mime type for a stored key, from its extension. */
export function mimeForKey(key: string): string {
  const ext = path.extname(key).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
