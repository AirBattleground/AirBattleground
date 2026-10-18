/**
 * Child-process helpers. Long-running children (scrcpy, ffmpeg, the emulator) go through the `Spawner`
 * interface so the state machine and pipeline can be tested with fake processes.
 */
import { execFile, spawn, type SpawnOptions } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { EventEmitter } from "node:events";

/** The part of ChildProcess the station uses. Emits "exit" (code, signal) exactly once. */
export interface Proc extends EventEmitter {
  readonly pid: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  /** last ~16 KB of stderr+stdout, for error messages */
  output(): string;
  readonly exited: boolean;
}

export type Spawner = (cmd: string, args: string[], opts?: { env?: NodeJS.ProcessEnv; detached?: boolean; logTo?: string }) => Proc;

class RealProc extends EventEmitter implements Proc {
  private buf = "";
  exited = false;
  constructor(private readonly child: ReturnType<typeof spawn>) {
    super();
    const keep = (d: Buffer) => {
      this.buf = (this.buf + d.toString()).slice(-16_384);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (err) => {
      this.buf += `\n${err.message}`;
      if (!this.exited) {
        this.exited = true;
        this.emit("exit", null, null);
      }
    });
    child.on("exit", (code, signal) => {
      if (this.exited) return;
      this.exited = true;
      this.emit("exit", code, signal);
    });
  }
  get pid() {
    return this.child.pid;
  }
  kill(signal: NodeJS.Signals = "SIGTERM") {
    if (this.exited) return false;
    try {
      return this.child.kill(signal);
    } catch {
      return false;
    }
  }
  output() {
    return this.buf;
  }
}

export const realSpawner: Spawner = (cmd, args, opts = {}) => {
  // a detached child (the emulator) must not write into our pipes: it outlives this process
  const fd = opts.logTo ? openSync(opts.logTo, "a") : null;
  const so: SpawnOptions = { env: opts.env ?? process.env, stdio: fd != null ? ["ignore", fd, fd] : ["ignore", "pipe", "pipe"], detached: opts.detached ?? false };
  const child = spawn(cmd, args, so);
  if (fd != null) closeSync(fd);
  if (opts.detached) child.unref();
  return new RealProc(child);
};

/** Wait for a Proc to exit (resolves immediately when it already has). */
export function waitExit(p: Proc, timeoutMs: number): Promise<boolean> {
  if (p.exited) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    p.once("exit", () => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

/** Ask nicely, then insist. */
export async function terminate(p: Proc, first: NodeJS.Signals = "SIGTERM", graceMs = 5000): Promise<void> {
  if (p.exited) return;
  p.kill(first);
  if (await waitExit(p, graceMs)) return;
  p.kill("SIGKILL");
  await waitExit(p, 2000);
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Run a short command and collect its output (binary-safe stdout). Never throws on a non-zero exit. */
export function run(cmd: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number; input?: Buffer } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { encoding: "buffer", timeout: opts.timeoutMs ?? 20_000, env: opts.env ?? process.env, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? ((err as { code?: unknown }).code as number | null) ?? 1 : 0;
        resolve({ code: typeof code === "number" ? code : 1, stdout: stdout ?? Buffer.alloc(0), stderr: (stderr ?? Buffer.alloc(0)).toString() + (err && !stderr?.length ? err.message : "") });
      },
    );
    if (opts.input) child.stdin?.on("error", () => {}).end(opts.input);
  });
}
