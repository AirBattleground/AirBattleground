/**
 * Where the video's picture actually sits inside the <video> element. With `object-fit: contain` the frame is
 * letterboxed (bars left/right for a portrait stream in a wide box, top/bottom for a landscape stream in a tall one),
 * so pointer → frame fractions must subtract the bars.
 */
interface ContentBox {
  /** offset of the picture inside the element, in CSS px */
  left: number;
  top: number;
  width: number;
  height: number;
}

function containBox(boxW: number, boxH: number, videoW: number, videoH: number): ContentBox | null {
  if (!(boxW > 0 && boxH > 0 && videoW > 0 && videoH > 0)) return null;
  const scale = Math.min(boxW / videoW, boxH / videoH);
  const width = videoW * scale;
  const height = videoH * scale;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/** Pointer position (relative to the element's top-left) → 0..1 fractions of the frame; null when on a letterbox bar. */
export function toFraction(px: number, py: number, box: ContentBox, clamp = false): { x: number; y: number } | null {
  let x = (px - box.left) / box.width;
  let y = (py - box.top) / box.height;
  if (clamp) {
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
  } else if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  // 4 decimals is sub-pixel on any phone screen and keeps payloads tidy
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

/** Content box of a <video> element (CSS px, relative to the element), or null before metadata is loaded. */
export function videoContentBox(video: HTMLVideoElement): ContentBox | null {
  const r = video.getBoundingClientRect();
  return containBox(r.width, r.height, video.videoWidth, video.videoHeight);
}
