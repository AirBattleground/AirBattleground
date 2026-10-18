/**
 * FrameSource: stands in for scrcpy in the capture pipeline. It writes the BlueStacks H.264 (Annex-B) stream into
 * the FIFO that ffmpeg reads. Looks like a child process (`Proc`): "exit" fires when the source ends or can't go on,
 * `kill()` closes the FIFO so ffmpeg sees EOF and finishes its files.
 *
 * The FIFO is opened read-write + non-blocking: opening it write-only would block forever if ffmpeg died before
 * opening its end. Writes that would block (ffmpeg slow) are queued; past MAX_BACKLOG the queue is dropped and
 * frames are skipped until the next keyframe.
 */
import { EventEmitter } from "node:events";
import { closeSync, constants as fsc, openSync, writeSync } from "node:fs";
import type { BsFrame, BsLink } from "./bluestacks.js";
import { log } from "./log.js";
import type { Proc } from "./proc.js";

const MAX_BACKLOG = 16 * 1024 * 1024;

export interface FrameSourceOptions {
  /** the link may be down for this long (reconnecting) before the source gives up and reports an exit */
  linkLostMs?: number;
}

export class FrameSource extends EventEmitter implements Proc {
  readonly pid = undefined;
  exited = false;
  private fd: number | null = null;
  private queue: Buffer[] = [];
  private queued = 0;
  private waitKey = true;
  private release: (() => void) | null = null;
  private lostTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastError = "";
  private frames = 0;

  constructor(
    private readonly link: BsLink,
    fifo: string,
    private readonly o: FrameSourceOptions = {},
  ) {
    super();
    try {
      this.fd = openSync(fifo, fsc.O_RDWR | fsc.O_NONBLOCK);
    } catch (err) {
      this.lastError = `can't open the capture pipe: ${(err as Error).message}`;
      queueMicrotask(() => this.end(1));
      return;
    }
    this.release = link.acquire();
    link.on("frame", this.onFrame);
    link.on("config", this.onConfig);
    link.on("close", this.onClose);
    link.on("open", this.onOpen);
    if (!link.connected) this.armLost();
    else link.requestKeyframe();
  }

  output() {
    return this.lastError || `${this.frames} frames`;
  }
  get framesWritten() {
    return this.frames;
  }

  private armLost() {
    if (this.lostTimer || this.exited) return;
    this.lostTimer = setTimeout(() => {
      this.lastError = "lost the BlueStacks stream";
      this.end(1);
    }, this.o.linkLostMs ?? 30_000);
  }
  private onOpen = () => {
    if (this.lostTimer) clearTimeout(this.lostTimer);
    this.lostTimer = null;
    this.waitKey = true;
    this.link.requestKeyframe();
  };
  private onClose = () => {
    this.waitKey = true;
    this.armLost();
  };
  private onConfig = () => {
    this.waitKey = true; // codec/stream changed: restart at the next keyframe
  };

  private onFrame = (f: BsFrame) => {
    if (this.exited) return;
    if (this.waitKey) {
      if (!f.key) return;
      this.waitKey = false;
    }
    this.frames++;
    this.push(f.data);
  };

  private push(buf: Buffer) {
    if (this.queued + buf.length > MAX_BACKLOG) {
      log.warn("capture backlog too large; skipping to the next keyframe");
      this.queue = [];
      this.queued = 0;
      this.waitKey = true;
      return;
    }
    this.queue.push(buf);
    this.queued += buf.length;
    this.flush();
  }

  private flush() {
    if (this.flushTimer) return;
    while (this.queue.length && this.fd != null) {
      const head = this.queue[0]!;
      try {
        const n = writeSync(this.fd, head);
        this.queued -= n;
        if (n < head.length) this.queue[0] = head.subarray(n);
        else this.queue.shift();
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EAGAIN") {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
          }, 15);
          return;
        }
        this.lastError = `write failed: ${(err as Error).message}`;
        this.end(1);
        return;
      }
    }
  }

  kill(): boolean {
    if (this.exited) return false;
    this.end(0);
    return true;
  }

  private end(code: number) {
    if (this.exited) return;
    this.exited = true;
    this.link.off("frame", this.onFrame);
    this.link.off("config", this.onConfig);
    this.link.off("close", this.onClose);
    this.link.off("open", this.onOpen);
    if (this.lostTimer) clearTimeout(this.lostTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.release?.();
    this.release = null;
    if (this.fd != null) {
      try {
        closeSync(this.fd);
      } catch {
        /* closed */
      }
      this.fd = null;
    }
    this.queue = [];
    this.emit("exit", code, null);
  }
}
