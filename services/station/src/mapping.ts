/**
 * Viewer → device coordinate mapping.
 *
 * The viewer clicks on the streamed frame, which scrcpy keeps upright (it follows the display rotation),
 * so a click is a 0..1 fraction of the CURRENT (rotated) screen. `adb shell input tap/swipe` takes
 * coordinates of that same rotated ("logical") screen on Android 10+ — verified on the bgmi14 AVD
 * (Android 14). INPUT_COORDS=natural switches to coordinates of the unrotated portrait panel for
 * devices/ROMs that expect those.
 */
export type Rotation = 0 | 1 | 2 | 3;

export interface ScreenSize {
  /** natural (rotation 0) size, e.g. 1080x2280 */
  width: number;
  height: number;
}

/** Size of the screen as displayed at `rotation`. */
export function displayedSize(screen: ScreenSize, rotation: Rotation): ScreenSize {
  return rotation % 2 === 1 ? { width: screen.height, height: screen.width } : { width: screen.width, height: screen.height };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Map a viewer fraction (fx, fy) to integer device coordinates. */
export function mapPoint(fx: number, fy: number, screen: ScreenSize, rotation: Rotation, mode: "logical" | "natural" = "logical"): { x: number; y: number } {
  const shown = displayedSize(screen, rotation);
  const lx = clamp01(fx) * (shown.width - 1);
  const ly = clamp01(fy) * (shown.height - 1);
  if (mode === "logical") return { x: Math.round(lx), y: Math.round(ly) };
  // logical (rotated) → natural panel coordinates. Rotation r = display rotated r*90° counter-clockwise.
  const W = screen.width - 1;
  const H = screen.height - 1;
  let x: number;
  let y: number;
  switch (rotation) {
    case 0:
      x = lx;
      y = ly;
      break;
    case 1: // landscape: logical x runs along natural -y
      x = W - ly;
      y = lx;
      break;
    case 2:
      x = W - lx;
      y = H - ly;
      break;
    case 3: // seascape
      x = ly;
      y = H - lx;
      break;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** Parse the current display rotation out of `dumpsys` output. null when not found. */
export function parseRotation(text: string): Rotation | null {
  // scrcpy (and other tools) add virtual displays: only look at the built-in display 0
  const start = text.search(/Display: mDisplayId=0\b/);
  if (start >= 0) {
    const rest = text.slice(start + 1);
    const end = rest.search(/Display: mDisplayId=\d+/);
    text = end >= 0 ? rest.slice(0, end) : rest;
  }
  const patterns = [
    /DisplayRotation[\s\S]*?\bmRotation=(\d)\b/, // dumpsys window displays (Android 12+)
    /\bmCurrentOrientation=(\d)\b/, // dumpsys display
    /SurfaceOrientation:\s*(\d)/, // dumpsys input (older Android)
    /mDisplayRotation=ROTATION_(0|90|180|270)/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const v = Number(m[1]);
    const r = v >= 90 ? v / 90 : v;
    if (r === 0 || r === 1 || r === 2 || r === 3) return r;
  }
  return null;
}

/** "Physical size: 1080x2280\nOverride size: …" → natural size (physical, ignoring overrides). */
export function parseWmSize(text: string): ScreenSize | null {
  const m = /Physical size:\s*(\d+)x(\d+)/.exec(text) ?? /(\d+)x(\d+)/.exec(text);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** Escape text for `adb shell input text` (spaces → %s, shell metacharacters quoted). */
export function escapeInputText(text: string): string {
  // keep printable ASCII only; input text can't type anything else reliably
  const clean = text.replace(/[^\x20-\x7e]/g, "");
  return clean.replace(/ /g, "%s").replace(/([\\'"`$&|;<>()*?!#~{}[\]^])/g, "\\$1");
}
