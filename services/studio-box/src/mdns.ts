/**
 * Bonjour: advertise `_7xen-studio._tcp` (TXT name=<box name>, api=<LAN URL>) so the 7XEN Stream app can list
 * "Studios on this Wi-Fi". Zero dependencies: uses the OS tool when it's there — avahi-publish-service (Linux,
 * package avahi-utils) or dns-sd (macOS / Windows with Bonjour). Without one, phones pair by QR as usual.
 */
import { spawn, type ChildProcess } from "node:child_process";

export function mdnsCommand(platform: NodeJS.Platform, name: string, port: number, api: string): [string, string[]] {
  const txt = [`name=${name}`, `api=${api}`];
  if (platform === "linux") return ["avahi-publish-service", [name, "_7xen-studio._tcp", String(port), ...txt]];
  return ["dns-sd", ["-R", name, "_7xen-studio._tcp", "local", String(port), ...txt]];
}

export function advertise(name: string, port: number, api: string, log: (msg: string) => void): () => void {
  const [cmd, args] = mdnsCommand(process.platform, name, port, api);
  let child: ChildProcess | null = null;
  try {
    child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", () => {
      log(`Bonjour not advertised (${cmd} not installed) — phones pair with the QR code`);
      child = null;
    });
    child.on("spawn", () => log(`Bonjour: advertising _7xen-studio._tcp as "${name}"`));
  } catch {
    child = null;
  }
  return () => {
    child?.kill();
  };
}
