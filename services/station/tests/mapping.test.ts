import { describe, expect, it } from "vitest";
import { displayedSize, escapeInputText, mapPoint, parseRotation, parseWmSize, type Rotation } from "../src/mapping.js";
import { parseDevices } from "../src/adb.js";
import { parseDuration } from "../src/finalize.js";

const PHONE = { width: 1080, height: 2280 };

describe("displayedSize", () => {
  it("swaps width/height for landscape rotations", () => {
    expect(displayedSize(PHONE, 0)).toEqual({ width: 1080, height: 2280 });
    expect(displayedSize(PHONE, 1)).toEqual({ width: 2280, height: 1080 });
    expect(displayedSize(PHONE, 2)).toEqual({ width: 1080, height: 2280 });
    expect(displayedSize(PHONE, 3)).toEqual({ width: 2280, height: 1080 });
  });
});

describe("mapPoint (logical: what adb input expects on Android 10+)", () => {
  it("portrait: fractions of 1080x2280", () => {
    expect(mapPoint(0, 0, PHONE, 0)).toEqual({ x: 0, y: 0 });
    expect(mapPoint(1, 1, PHONE, 0)).toEqual({ x: 1079, y: 2279 });
    expect(mapPoint(0.5, 0.25, PHONE, 0)).toEqual({ x: 540, y: 570 });
  });
  it("landscape (BGMI): fractions of the rotated 2280x1080 frame", () => {
    expect(mapPoint(0.5, 0.5, PHONE, 1)).toEqual({ x: 1140, y: 540 });
    expect(mapPoint(1, 0, PHONE, 1)).toEqual({ x: 2279, y: 0 });
    expect(mapPoint(0.25, 0.75, PHONE, 3)).toEqual({ x: 570, y: 809 });
  });
  it("clamps out-of-range and NaN values", () => {
    expect(mapPoint(-1, 2, PHONE, 1)).toEqual({ x: 0, y: 1079 });
    expect(mapPoint(Number.NaN, 0.5, PHONE, 0)).toEqual({ x: 0, y: 1140 });
  });
});

describe("mapPoint (natural panel coordinates)", () => {
  const corners = (r: Rotation) => ({
    topLeft: mapPoint(0, 0, PHONE, r, "natural"),
    topRight: mapPoint(1, 0, PHONE, r, "natural"),
    bottomLeft: mapPoint(0, 1, PHONE, r, "natural"),
  });
  it("rotation 0 is the identity", () => {
    expect(corners(0)).toEqual({ topLeft: { x: 0, y: 0 }, topRight: { x: 1079, y: 0 }, bottomLeft: { x: 0, y: 2279 } });
  });
  it("rotation 1: the viewer's top-left is the panel's top-right", () => {
    expect(corners(1)).toEqual({ topLeft: { x: 1079, y: 0 }, topRight: { x: 1079, y: 2279 }, bottomLeft: { x: 0, y: 0 } });
  });
  it("rotation 2: upside down", () => {
    expect(corners(2)).toEqual({ topLeft: { x: 1079, y: 2279 }, topRight: { x: 0, y: 2279 }, bottomLeft: { x: 1079, y: 0 } });
  });
  it("rotation 3: the viewer's top-left is the panel's bottom-left", () => {
    expect(corners(3)).toEqual({ topLeft: { x: 0, y: 2279 }, topRight: { x: 0, y: 0 }, bottomLeft: { x: 1079, y: 2279 } });
  });
  it("the centre stays the centre in every rotation", () => {
    for (const r of [0, 1, 2, 3] as Rotation[]) {
      const c = mapPoint(0.5, 0.5, PHONE, r, "natural");
      expect(Math.abs(c.x - 539.5)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - 1139.5)).toBeLessThanOrEqual(1);
    }
  });
});

describe("parsers", () => {
  it("reads the rotation from dumpsys window / display / input", () => {
    expect(parseRotation("  DisplayRotation\n    mRotation=1 mDeferredRotationPauseCount=0\n")).toBe(1);
    expect(parseRotation("    mCurrentOrientation=3\n")).toBe(3);
    expect(parseRotation("      SurfaceOrientation: 2\n")).toBe(2);
    expect(parseRotation("mDisplayRotation=ROTATION_270 mWindowingMode")).toBe(3);
    expect(parseRotation("nothing here")).toBeNull();
  });
  it("ignores scrcpy's virtual display and reads display 0", () => {
    const text = [
      "  Display: mDisplayId=15",
      "  overrideConfig={ mDisplayRotation=ROTATION_0 }",
      "  DisplayRotation",
      "    mRotation=0 mDeferredRotationPauseCount=0",
      "  Display: mDisplayId=0 (organized)",
      "  overrideConfig={ mDisplayRotation=ROTATION_90 }",
      "  DisplayRotation",
      "    mRotation=1 mDeferredRotationPauseCount=0",
      "",
    ].join("\n");
    expect(parseRotation(text)).toBe(1);
  });
  it("prefers DisplayRotation over earlier config lines", () => {
    const text = "overrideConfig={ mDisplayRotation=ROTATION_0 }\n  DisplayRotation\n    mRotation=1 x\n";
    expect(parseRotation(text)).toBe(1);
  });
  it("reads wm size (physical, not override)", () => {
    expect(parseWmSize("Physical size: 1080x2280\nOverride size: 720x1520\n")).toEqual({ width: 1080, height: 2280 });
  });
  it("parses adb devices", () => {
    expect(parseDevices("List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\n\n")).toEqual([
      { serial: "emulator-5554", state: "device" },
      { serial: "R58M", state: "unauthorized" },
    ]);
  });
  it("parses ffmpeg durations", () => {
    expect(parseDuration("  Duration: 00:01:02.50, start: 0")).toBe(63);
    expect(parseDuration("no duration")).toBeUndefined();
  });
  it("escapes text for adb input", () => {
    expect(escapeInputText("room 1234")).toBe("room%s1234");
    expect(escapeInputText("a;b&c$(x)")).toBe("a\\;b\\&c\\$\\(x\\)");
    expect(escapeInputText("héllo")).toBe("hllo");
  });
});
