/**
 * Emulator lifecycle: reuse a running emulator, otherwise start the AVD (window on the owner's desktop,
 * DISPLAY) and wait for it to boot. The emulator is started detached with its output in a log file, so it
 * keeps running when the station restarts; the station never kills it.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Device } from "./adb.js";
import { log } from "./log.js";
import type { Proc, Spawner } from "./proc.js";

export interface EmulatorOptions {
  emulator: string;
  avd: string;
  avdHome: string;
  androidHome: string;
  display: string;
  args: string[];
  bootTimeoutMs: number;
  logDir: string;
  pollMs?: number;
}

export type EnsureEmulator = (onBooting?: () => void) => Promise<string>;

export function makeEnsureEmulator(device: Device, spawner: Spawner, o: EmulatorOptions): EnsureEmulator {
  let starting: Promise<string> | null = null;
  const poll = o.pollMs ?? 2000;

  async function waitBoot(proc: Proc | null, deadline: number): Promise<string> {
    for (;;) {
      const dev = await device.find();
      if (dev && dev.state === "device" && (await device.isBooted(dev.serial))) return dev.serial;
      if (proc?.exited) throw new Error(`The emulator closed while starting: ${proc.output().trim().split("\n").slice(-3).join(" | ") || "see emulator.log"}`);
      if (Date.now() > deadline) throw new Error("The emulator took too long to start");
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  return async (onBooting) => {
    const dev = await device.find();
    if (dev && dev.state === "device" && (await device.isBooted(dev.serial))) return dev.serial;
    onBooting?.();
    if (dev) return waitBoot(null, Date.now() + o.bootTimeoutMs); // running, still booting
    if (!starting) {
      starting = (async () => {
        await mkdir(o.logDir, { recursive: true });
        log.info("starting emulator", { avd: o.avd });
        const proc = spawner(o.emulator, ["-avd", o.avd, ...o.args], {
          detached: true,
          logTo: path.join(o.logDir, "emulator.log"),
          env: { ...process.env, DISPLAY: o.display, ANDROID_HOME: o.androidHome, ANDROID_SDK_ROOT: o.androidHome, ANDROID_AVD_HOME: o.avdHome },
        });
        return waitBoot(proc, Date.now() + o.bootTimeoutMs);
      })().finally(() => {
        starting = null;
      });
    }
    return starting;
  };
}
