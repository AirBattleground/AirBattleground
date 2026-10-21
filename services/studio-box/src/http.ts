/** Small node:http helpers: the API error shape, JSON bodies, zod validation, multipart image upload, rate limit. */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ZodTypeAny, z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (message = "Not found") => new HttpError(404, "NOT_FOUND", message);

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(data), ...headers });
  res.end(data);
}

export function sendError(res: ServerResponse, err: unknown) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } });
    return;
  }
  console.error("box: unexpected error", err);
  sendJson(res, 500, { error: { code: "INTERNAL", message: "Something went wrong on the Studio box. Try again." } });
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "VALIDATION_ERROR", "That upload is too big"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "The request body isn't valid JSON");
  }
}

/** Same 400 VALIDATION_ERROR shape as the API. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  const first = Object.values(fields)[0];
  throw new HttpError(400, "VALIDATION_ERROR", Object.keys(fields).length === 1 && first ? `Please check your input: ${first}` : "Please check the highlighted fields", fields);
}

/** PNG / JPEG / WebP by magic bytes */
export function isImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0x89 && b.subarray(1, 4).toString("latin1") === "PNG") return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  return b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
}

/** The first file part named one of `names` from a multipart/form-data body (null when there is none). */
export function multipartFile(body: Buffer, contentType: string | undefined, names: string[]): Buffer | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = m?.[1] ?? m?.[2]?.trim();
  if (!boundary) return null;
  const delim = Buffer.from(`--${boundary}`);
  let pos = body.indexOf(delim);
  while (pos >= 0) {
    const start = pos + delim.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const headerEnd = body.indexOf("\r\n\r\n", start);
    if (headerEnd < 0) break;
    const headers = body.subarray(start, headerEnd).toString("utf8");
    const next = body.indexOf(delim, headerEnd + 4);
    if (next < 0) break;
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    // part content ends with CRLF before the next delimiter
    if (name && names.includes(name)) return body.subarray(headerEnd + 4, next - 2);
    pos = next;
  }
  return null;
}

/** Fixed-window limiter per key (stops key guessing on the device API). */
export function rateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    if (hits.size > 10_000) hits.clear();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}

export const remoteIp = (req: IncomingMessage) => req.socket.remoteAddress ?? "";
