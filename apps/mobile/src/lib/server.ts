/** Server address handling (the API base the app talks to). Pure — unit tested. */
export const DEFAULT_SERVER_URL = "http://192.168.0.199";

/**
 * Turns whatever the manager typed into a clean base URL: adds http:// when missing,
 * drops trailing slashes and a trailing "/api". Returns null when it can't be a URL.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, "").replace(/\/api$/i, "").replace(/\/+$/, "");
  const m = /^(https?):\/\/([^/\s?#]+)(\/[^\s?#]*)?$/i.exec(s);
  if (!m) return null;
  const host = m[2]!;
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(host)) return null;
  return `${m[1]!.toLowerCase()}://${host.toLowerCase()}${m[3] ?? ""}`;
}

/** Absolute URL for an API path or a URL the server returned (which may be relative). */
export function resolveUrl(base: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return base.replace(/\/+$/, "") + (pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`);
}
