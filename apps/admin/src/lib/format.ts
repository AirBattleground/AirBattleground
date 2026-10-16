import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

/** "3 days ago" / "Never" */
export function relativeTime(iso: string | null | undefined, empty = "Never"): string {
  if (!iso) return empty;
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return empty;
  }
}

/** "12 Oct 2026" */
export function shortDate(iso: string): string {
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
}

/** Turn a display name into a valid username suggestion (a-z, 0-9, _ and .). */
export function suggestUsername(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "@#$%&*!?";

function pick(set: string): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return set[buf[0]! % set.length]!;
}

/** Strong random password without look-alike characters (no 0/O, 1/l/I). */
export function generatePassword(length = 14): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle with crypto randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/**
 * Team & manager portal address for "Copy login details". Production serves admin at <site>/admin-ui,
 * so the portal is the same origin; the dev admin (:5174) pairs with the dev portal on :5173.
 */
export const PORTAL_URL: string =
  (import.meta.env.VITE_PORTAL_URL as string | undefined) ??
  (window.location.port === "5174" ? `${window.location.protocol}//${window.location.hostname}:5173` : window.location.origin);

/** Message the admin can paste into WhatsApp. */
export function loginDetailsMessage(opts: { who: string; role: "Manager" | "Team"; username: string; password: string }): string {
  return [
    `*7XEN ${opts.role} login* — ${opts.who}`,
    "",
    `Portal: ${PORTAL_URL}`,
    `Username: ${opts.username}`,
    `Password: ${opts.password}`,
    "",
    "Keep these details private. Ask the admin if you need a new password.",
  ].join("\n");
}

/** Copy text to clipboard; falls back to a hidden textarea on insecure origins. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
