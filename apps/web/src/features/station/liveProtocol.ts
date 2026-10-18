/** Pure helpers for the BlueStacks live stream WebSocket (binary client messages, frame header, finger ids). */

export type TouchAction = "down" | "up" | "move";
const ACTION: Record<TouchAction, number> = { down: 0, up: 1, move: 2 };

/** Max simultaneous fingers. */
export const MAX_FINGERS = 10;

const clamp16 = (f: number) => Math.min(65535, Math.max(0, Math.round(f * 65535)));

/** Touch message: [0, action, id, x u16BE, y u16BE, w u16BE, h u16BE]; x/y are fractions 0..1 of the picture. */
export function encodeTouch(action: TouchAction, fingerId: number, x: number, y: number): Uint8Array {
  const b = new Uint8Array(11);
  const v = new DataView(b.buffer);
  b[0] = 0;
  b[1] = ACTION[action];
  b[2] = fingerId;
  v.setUint16(3, clamp16(x));
  v.setUint16(5, clamp16(y));
  // w,h stay 0: the station maps x/y across the picture
  return b;
}

/** Ask for a keyframe (send right after the socket opens). */
export const encodeKeyframeRequest = (): Uint8Array => new Uint8Array([2]);

export type KeyName = "Enter" | "Backspace" | "Delete" | "Tab" | "Escape" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";

/** Key message: [3, action (0 down / 1 up), ...utf8 KeyName]. */
export function encodeKey(action: "down" | "up", key: KeyName): Uint8Array {
  const name = new TextEncoder().encode(key);
  const b = new Uint8Array(2 + name.length);
  b[0] = 3;
  b[1] = action === "down" ? 0 : 1;
  b.set(name, 2);
  return b;
}

export const MAX_TEXT_BYTES = 300;

/** Text messages: [4, ...utf8], each at most `maxChars` characters (a few per message) and under 300 bytes. */
export function encodeText(text: string, maxChars = 8): Uint8Array[] {
  const enc = new TextEncoder();
  const out: Uint8Array[] = [];
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += maxChars) {
    const body = enc.encode(chars.slice(i, i + maxChars).join("")).slice(0, MAX_TEXT_BYTES - 1);
    const b = new Uint8Array(1 + body.length);
    b[0] = 4;
    b.set(body, 1);
    out.push(b);
  }
  return out;
}

/** Server video frame: [flag u8 (1 = key)][capture time µs f64 BE][H.264 Annex-B]. */
export interface VideoFrame {
  key: boolean;
  captureUs: number;
  data: Uint8Array;
}

export function parseFrame(buf: ArrayBuffer | Uint8Array): VideoFrame | null {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length <= 9) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { key: b[0] === 1, captureUs: v.getFloat64(1, false), data: b.subarray(9) };
}

/** Lowest free finger id for a pointer (stable per pointer); null when all ten are used. */
export class FingerMap {
  private ids = new Map<number, number>();

  /** id for a pointer, allocating the lowest free one on first sight. */
  acquire(pointerId: number): number | null {
    const have = this.ids.get(pointerId);
    if (have !== undefined) return have;
    const used = new Set(this.ids.values());
    for (let i = 0; i < MAX_FINGERS; i++) {
      if (!used.has(i)) {
        this.ids.set(pointerId, i);
        return i;
      }
    }
    return null;
  }

  get(pointerId: number): number | undefined {
    return this.ids.get(pointerId);
  }

  release(pointerId: number): number | undefined {
    const id = this.ids.get(pointerId);
    this.ids.delete(pointerId);
    return id;
  }

  /** all (pointerId, fingerId) pairs currently down */
  entries(): [number, number][] {
    return [...this.ids.entries()];
  }

  clear() {
    this.ids.clear();
  }
}

/** Reconnect delay: 1, 2, 4 … capped at 5 s. */
export const reconnectDelay = (attempt: number) => Math.min(5000, 1000 * 2 ** attempt);

/** WebSocket URL of a match's stream, same origin as the page. */
export function streamUrl(matchId: string, loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}/api/manager/matches/${matchId}/station/stream`;
}
