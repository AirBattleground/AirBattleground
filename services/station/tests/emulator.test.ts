import { describe, expect, it, vi } from "vitest";
import type { Device } from "../src/adb.js";
import { makeEnsureEmulator } from "../src/emulator.js";

function fakeDevice(found: { serial: string; state: string } | null, booted = true): Device {
  return { find: vi.fn(async () => found), isBooted: vi.fn(async () => booted) } as unknown as Device;
}
const opts = { emulator: "emu", avd: "a", avdHome: "/h", androidHome: "/s", display: ":0", args: [], bootTimeoutMs: 1000, logDir: "/tmp/x", pollMs: 5 };

describe("ensureEmulator", () => {
  it("reuses a booted device", async () => {
    const spawner = vi.fn();
    const ensure = makeEnsureEmulator(fakeDevice({ serial: "emulator-5554", state: "device" }), spawner as never, opts);
    await expect(ensure()).resolves.toBe("emulator-5554");
    expect(spawner).not.toHaveBeenCalled();
  });

  it("remote device: uses it and never starts the local AVD", async () => {
    const spawner = vi.fn();
    const ensure = makeEnsureEmulator(fakeDevice({ serial: "192.168.0.50:5556", state: "device" }), spawner as never, { ...opts, remote: "192.168.0.50:5556" });
    await expect(ensure()).resolves.toBe("192.168.0.50:5556");
    expect(spawner).not.toHaveBeenCalled();
  });

  it("remote device unreachable: friendly error, no local AVD", async () => {
    const spawner = vi.fn();
    const ensure = makeEnsureEmulator(fakeDevice(null), spawner as never, { ...opts, remote: "192.168.0.50:5556", remoteTimeoutMs: 30 });
    await expect(ensure()).rejects.toThrow(/Can't reach the Android device at 192\.168\.0\.50:5556/);
    expect(spawner).not.toHaveBeenCalled();
  });
});
