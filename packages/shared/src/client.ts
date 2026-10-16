import type { ApiErrorBody, ApiErrorCode } from "./dto";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Tiny fetch wrapper used by both frontends. Sends cookies, JSON in/out, throws ApiError.
 * `onUnauthenticated` fires on 401 so the app can drop its session and redirect to login.
 */
export function createApiClient(opts: { baseUrl?: string; onUnauthenticated?: () => void } = {}) {
  const base = opts.baseUrl ?? "";
  async function request<T>(method: Method, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    let url = base + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        credentials: "include",
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "INTERNAL", "Can't reach the server. Check your connection and try again.");
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const err = (data as ApiErrorBody | null)?.error;
      if (res.status === 401) opts.onUnauthenticated?.();
      throw new ApiError(res.status, err?.code ?? "INTERNAL", err?.message ?? "Something went wrong. Please try again.", err?.fields);
    }
    return data as T;
  }
  return {
    get: <T>(path: string, query?: Record<string, string | number | undefined>) => request<T>("GET", path, undefined, query),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    del: <T = void>(path: string) => request<T>("DELETE", path),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
