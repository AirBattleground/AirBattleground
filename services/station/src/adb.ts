/** adb wrapper: device discovery, health facts, screenshots and input. */
import type { StationInput } from "@7xen/shared";
import { escapeInputText, mapPoint, parseRotation, parseWmSize, type Rotation, type ScreenSize } from "./mapping.js";
import { run } from "./proc.js";

const KEYCODES: Record<string, string> = { BACK: "KEYCODE_BACK", HOME: "KEYCODE_HOME", APP_SWITCH: "KEYCODE_APP_SWITCH", ENTER: "KEYCODE_ENTER", DEL: "KEYCODE_DEL" };

export interface DeviceFacts {
  serial: string | null;
  /** "device" | "offline" | "unauthorized" | null */
  state: string | null;
  booted: boolean;
  screen: ScreenSize | null;
  rotation: Rotation | null;
  bgmiInstalled: boolean;
}

/** Everything the station needs from a device. Implemented with adb; faked in tests. */
export interface Device {
  /** first matching device line from `adb devices` */
  find(): Promise<{ serial: string; state: string } | null>;
  facts(): Promise<DeviceFacts>;
  isBooted(serial: string): Promise<boolean>;
  rotation(serial: string): Promise<Rotation | null>;
  screen(serial: string): Promise<ScreenSize | null>;
  isInstalled(serial: string, pkg: string): Promise<boolean>;
  launch(serial: string, pkg: string): Promise<void>;
  screencap(serial: string): Promise<Buffer>;
  input(serial: string, input: StationInput, mode: "logical" | "natural"): Promise<void>;
}

/** `adb devices` → [{ serial, state }] */
export function parseDevices(text: string): { serial: string; state: string }[] {
  return text
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[0])
    .map((p) => ({ serial: p[0]!, state: p[1]! }));
}

export class AdbDevice implements Device {
  /** last known natural screen size per serial (doesn't change) */
  private screens = new Map<string, ScreenSize>();
  constructor(
    private readonly adbPath: string,
    private readonly wantSerial: string,
    private readonly bgmiPackage: string,
    /** "host:port" reached over the network: `adb connect` it whenever it isn't listed */
    private readonly remote = "",
  ) {}

  private sh(serial: string, args: string[], timeoutMs = 15_000) {
    return run(this.adbPath, ["-s", serial, ...args], { timeoutMs });
  }

  private async list() {
    const r = await run(this.adbPath, ["devices"], { timeoutMs: 10_000 });
    return r.code === 0 ? parseDevices(r.stdout.toString()) : null;
  }

  async find() {
    let all = await this.list();
    if (!all) return null;
    if (this.remote && !all.some((d) => d.serial === this.remote && d.state === "device")) {
      if (all.some((d) => d.serial === this.remote)) await run(this.adbPath, ["disconnect", this.remote], { timeoutMs: 5000 });
      await run(this.adbPath, ["connect", this.remote], { timeoutMs: 8000 });
      all = (await this.list()) ?? [];
    }
    if (this.wantSerial) return all.find((d) => d.serial === this.wantSerial) ?? null;
    return all.find((d) => d.serial.startsWith("emulator-") && d.state === "device") ?? all.find((d) => d.serial.startsWith("emulator-")) ?? null;
  }

  async isBooted(serial: string) {
    const r = await this.sh(serial, ["shell", "getprop", "sys.boot_completed"], 8000);
    return r.code === 0 && r.stdout.toString().trim() === "1";
  }

  async rotation(serial: string) {
    const r = await this.sh(serial, ["shell", "dumpsys", "window", "displays"], 8000);
    const rot = r.code === 0 ? parseRotation(r.stdout.toString()) : null;
    if (rot != null) return rot;
    const d = await this.sh(serial, ["shell", "dumpsys", "display"], 8000);
    return d.code === 0 ? parseRotation(d.stdout.toString()) : null;
  }

  async screen(serial: string) {
    const known = this.screens.get(serial);
    if (known) return known;
    const r = await this.sh(serial, ["shell", "wm", "size"], 8000);
    const s = r.code === 0 ? parseWmSize(r.stdout.toString()) : null;
    if (s) this.screens.set(serial, s);
    return s;
  }

  async isInstalled(serial: string, pkg: string) {
    const r = await this.sh(serial, ["shell", "pm", "path", pkg], 10_000);
    return r.code === 0 && r.stdout.toString().includes("package:");
  }

  async facts(): Promise<DeviceFacts> {
    const dev = await this.find();
    if (!dev) return { serial: null, state: null, booted: false, screen: null, rotation: null, bgmiInstalled: false };
    if (dev.state !== "device") return { serial: dev.serial, state: dev.state, booted: false, screen: null, rotation: null, bgmiInstalled: false };
    const booted = await this.isBooted(dev.serial);
    if (!booted) return { serial: dev.serial, state: dev.state, booted, screen: null, rotation: null, bgmiInstalled: false };
    const [screen, rotation, bgmiInstalled] = await Promise.all([this.screen(dev.serial), this.rotation(dev.serial), this.isInstalled(dev.serial, this.bgmiPackage)]);
    return { serial: dev.serial, state: dev.state, booted, screen, rotation, bgmiInstalled };
  }

  async launch(serial: string, pkg: string) {
    const r = await this.sh(serial, ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], 20_000);
    if (r.code !== 0) throw new Error(`could not launch ${pkg}: ${r.stderr.slice(-200)}`);
  }

  async screencap(serial: string) {
    const r = await run(this.adbPath, ["-s", serial, "exec-out", "screencap", "-p"], { timeoutMs: 20_000 });
    const png = r.stdout;
    if (r.code !== 0 || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new Error(`screencap failed: ${r.stderr.slice(-200)}`);
    return png;
  }

  async input(serial: string, input: StationInput, mode: "logical" | "natural") {
    let args: string[];
    if (input.type === "key") {
      args = ["shell", "input", "keyevent", KEYCODES[input.key]!];
    } else if (input.type === "text") {
      const t = escapeInputText(input.text);
      if (!t) return;
      args = ["shell", "input", "text", t];
    } else {
      const [screen, rotation] = await Promise.all([this.screen(serial), this.rotation(serial)]);
      if (!screen) throw new Error("screen size unknown");
      const rot = rotation ?? 0;
      const a = mapPoint(input.x, input.y, screen, rot, mode);
      if (input.type === "tap") {
        args = ["shell", "input", "tap", String(a.x), String(a.y)];
      } else {
        const b = mapPoint(input.x2, input.y2, screen, rot, mode);
        args = ["shell", "input", "swipe", String(a.x), String(a.y), String(b.x), String(b.y), String(input.durationMs ?? 300)];
      }
    }
    const r = await this.sh(serial, args, 15_000);
    if (r.code !== 0) throw new Error(`input failed: ${r.stderr.slice(-200)}`);
  }
}
