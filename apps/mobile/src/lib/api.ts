/**
 * Bearer-token API client for the 7XEN Manager app. Same error semantics as
 * createApiClient in @7xen/shared (throws ApiError, plain messages) but sends
 * `Authorization: Bearer <token>` instead of cookies and has a request timeout.
 */
import { ApiError, type ApiErrorBody, type ApiErrorCode } from "@7xen/shared";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Query = Record<string, string | number | undefined>;

export interface BearerClientOptions {
  getBaseUrl: () => string;
  getToken: () => string | null;
  /** fires on 401 for an authenticated request (token expired/revoked) */
  onUnauthenticated?: () => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function fallbackMessage(status: number): string {
  if (status === 0) return "Can't reach the server. Check the Wi-Fi and the server address in Settings.";
  if (status === 401) return "Your sign-in has expired. Please sign in again.";
  if (status === 403) return "This account can't do that.";
  if (status === 404) return "That wasn't found. It may have been deleted.";
  if (status === 413) return "That upload is too large.";
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (status === 502 || status === 503 || status === 504) return "The server is restarting or busy. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}
function fallbackCode(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 413) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL";
}

export function buildUrl(base: string, path: string, query?: Query): string {
  let url = base.replace(/\/+$/, "") + path;
  if (query) {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (parts.length) url += `?${parts.join("&")}`;
  }
  return url;
}

export function createBearerClient(opts: BearerClientOptions) {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 15000;

  async function request<T>(method: Method, path: string, body?: unknown, query?: Query, init?: { auth?: boolean }): Promise<T> {
    const url = buildUrl(opts.getBaseUrl(), path, query);
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = init?.auth === false ? null : opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl?.signal });
    } catch {
      throw new ApiError(0, "INTERNAL", fallbackMessage(0));
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (res.status === 401 && token) opts.onUnauthenticated?.();
      throw new ApiError(res.status, err?.code ?? fallbackCode(res.status), err?.message ?? fallbackMessage(res.status), err?.fields);
    }
    return data as T;
  }

  return {
    get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
    post: <T>(path: string, body?: unknown, init?: { auth?: boolean }) => request<T>("POST", path, body ?? {}, undefined, init),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    del: <T = void>(path: string) => request<T>("DELETE", path),
  };
}
export type BearerClient = ReturnType<typeof createBearerClient>;

/** Plain-words message for anything thrown by the client (or elsewhere). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}
