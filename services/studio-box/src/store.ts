/**
 * The box's own little database: DATA_DIR/devices.json (paired phones) and DATA_DIR/secret (generated once; signs
 * phone publish tokens and derives the media server's internal password). Writes are atomic (temp file + rename).
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEVICE_KEY_PREFIX } from "@7xen/shared";

export interface StoredDevice {
  id: string;
  name: string;
  /** sha256 of the key (the key itself is shown once and never stored) */
  keyHash: string;
  keyPrefix: string;
  createdAt: string;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  /** last hello */
  lastHelloAt: string | null;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newDeviceKey = () => DEVICE_KEY_PREFIX + randomBytes(24).toString("base64url");
/** 24 lowercase alphanumerics — fits MediaMTX's live/dev_[A-Za-z0-9]{8,40} path */
export const newDeviceId = () => "b" + randomBytes(12).toString("hex").slice(0, 23);

function writeAtomic(file: string, data: string, mode?: number) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, mode ? { mode } : undefined);
  renameSync(tmp, file);
}

export class Store {
  private devices: StoredDevice[] = [];
  readonly secret: Buffer;
  private readonly file: string;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    const secretFile = path.join(dir, "secret");
    if (!existsSync(secretFile)) writeAtomic(secretFile, randomBytes(32).toString("hex"), 0o600);
    this.secret = Buffer.from(readFileSync(secretFile, "utf8").trim(), "hex");
    if (this.secret.length < 16) throw new Error(`${secretFile} is damaged — delete it (phones must then be paired again)`);
    this.file = path.join(dir, "devices.json");
    if (existsSync(this.file)) {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { devices?: StoredDevice[] };
      this.devices = Array.isArray(raw.devices) ? raw.devices : [];
    }
  }

  private save() {
    writeAtomic(this.file, JSON.stringify({ devices: this.devices }, null, 2));
  }

  list(): StoredDevice[] {
    return [...this.devices].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): StoredDevice | undefined {
    return this.devices.find((d) => d.id === id);
  }

  byKey(key: string): StoredDevice | undefined {
    const h = sha256(key);
    return this.devices.find((d) => d.keyHash === h);
  }

  create(name: string): { device: StoredDevice; key: string } {
    const key = newDeviceKey();
    const device: StoredDevice = {
      id: newDeviceId(),
      name,
      keyHash: sha256(key),
      keyPrefix: key.slice(0, DEVICE_KEY_PREFIX.length + 4),
      createdAt: new Date().toISOString(),
      model: null,
      osVersion: null,
      appVersion: null,
      lastHelloAt: null,
    };
    this.devices.push(device);
    this.save();
    return { device, key };
  }

  update(id: string, patch: Partial<Omit<StoredDevice, "id" | "keyHash" | "createdAt">>): StoredDevice | undefined {
    const d = this.get(id);
    if (!d) return undefined;
    Object.assign(d, patch);
    this.save();
    return d;
  }

  remove(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.save();
    return true;
  }
}
