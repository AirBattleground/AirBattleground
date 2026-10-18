/**
 * FrameSource: stands in for scrcpy in the capture pipeline. It writes the BlueStacks H.264 stream into the FIFO
 * that ffmpeg reads, wrapped in FLV so every frame keeps the Mac's capture time. (Stamping frames on arrival made
 * Wi-Fi bursts play back jerky, and two frames < 11 µs apart collided in MPEG-TS's 90 kHz clock, which silently
 * killed the live HLS output.) Looks like a child process (`Proc`): "exit" fires when the source ends or can't go on,
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
/** a capture-time jump bigger than this (or backwards) means the Mac's clock restarted: continue from the last output */
const MAX_TS_JUMP_US = 30_000_000;
const NAL_IDR = 5;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/** Annex-B access unit → NAL units without start codes. */
export function splitNals(au: Buffer): Buffer[] {
  const nals: Buffer[] = [];
  let start = -1;
  for (let i = 0; i + 2 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1) {
      if (start >= 0) nals.push(au.subarray(start, i > 0 && au[i - 1] === 0 ? i - 1 : i));
      start = i + 3;
      i += 2;
    }
  }
  if (start >= 0 && start < au.length) nals.push(au.subarray(start));
  return nals.filter((n) => n.length > 0);
}

const FLV_HEADER = Buffer.from([0x46, 0x4c, 0x56, 1, 0x01 /* video only */, 0, 0, 0, 9, 0, 0, 0, 0 /* PreviousTagSize0 */]);

function flvTag(ms: number, body: Buffer): Buffer {
  const head = Buffer.alloc(11);
  head[0] = 9; // video
  head.writeUIntBE(body.length, 1, 3);
  head.writeUIntBE(ms & 0xffffff, 4, 3);
  head[7] = (ms >>> 24) & 0xff;
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(11 + body.length);
  return Buffer.concat([head, body, tail]);
}

/** AVC sequence header (AVCDecoderConfigurationRecord). */
function flvSequenceHeader(ms: number, sps: Buffer, pps: Buffer): Buffer {
  const rec = Buffer.concat([
    Buffer.from([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1]),
    u16(sps.length), sps,
    Buffer.from([1]), u16(pps.length), pps,
  ]);
  return flvTag(ms, Buffer.concat([Buffer.from([0x17, 0, 0, 0, 0]), rec]));
}

/** One frame as length-prefixed NALs (no B-frames from the Mac, so composition time 0). */
function flvFrame(ms: number, key: boolean, nals: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from([key ? 0x17 : 0x27, 1, 0, 0, 0])];
  for (const n of nals) parts.push(u32(n.length), n);
  return flvTag(ms, Buffer.concat(parts));
}

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

interface FrameSourceOptions {
  /** the link may be down for this long (reconnecting) before the source gives up and reports an exit */
  linkLostMs?: number;
}

export class FrameSource extends EventEmitter implements Proc {
  readonly pid = undefined;
  exited = false;
  private fd: number | null = null;
  private queue: Buffer[] = [];
  private queued = 0;
  /** queue[0] is partly written to the FIFO */
  private partial = false;
  private waitKey = true;
  private release: (() => void) | null = null;
  private lostTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastError = "";
  private frames = 0;
  private sps: Buffer | null = null;
  private pps: Buffer | null = null;
  private sentSps: Buffer | null = null;
  private sentPps: Buffer | null = null;
  private lastSrcUs: number | null = null;
  private baseUs = 0;
  private lastMs: number | null = null;

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
    this.push(FLV_HEADER);
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
    const nals = splitNals(f.data).filter((n) => (n[0]! & 0x1f) !== NAL_AUD);
    let idr = false;
    for (const n of nals) {
      const t = n[0]! & 0x1f;
      if (t === NAL_SPS) this.sps = Buffer.from(n);
      else if (t === NAL_PPS) this.pps = Buffer.from(n);
      else if (t === NAL_IDR) idr = true;
    }
    const key = f.key || idr;
    if (this.waitKey) {
      if (!key || !this.sps || !this.pps) return; // start at a keyframe we can describe
      this.waitKey = false;
    }
    if (!this.sps || !this.pps) return;
    const ms = this.clock(f.ts);
    if (!this.sentSps?.equals(this.sps) || !this.sentPps?.equals(this.pps)) {
      // first frame, or the size/codec changed (rotation): new sequence header; SPS/PPS also stay in-band
      this.push(flvSequenceHeader(ms, this.sps, this.pps));
      this.sentSps = this.sps;
      this.sentPps = this.pps;
    }
    this.frames++;
    this.push(flvFrame(ms, key, nals));
  };

  /** Mac capture time (µs) → strictly increasing FLV milliseconds starting at 0. */
  private clock(tsUs: number): number {
    const prev = this.lastSrcUs;
    if (prev == null || tsUs < prev || tsUs - prev > MAX_TS_JUMP_US) {
      // start, or the Mac's clock restarted: carry on one frame after the last output
      this.baseUs = this.lastMs == null ? tsUs : tsUs - (this.lastMs + 33) * 1000;
    }
    this.lastSrcUs = tsUs;
    let ms = Math.round((tsUs - this.baseUs) / 1000);
    if (this.lastMs != null && ms <= this.lastMs) ms = this.lastMs + 1;
    this.lastMs = ms;
    return ms;
  }

  private push(buf: Buffer) {
    if (this.queued + buf.length > MAX_BACKLOG) {
      log.warn("capture backlog too large; skipping to the next keyframe");
      // keep a tag that is half written (FLV can't resync mid-tag); drop the rest
      const head = this.partial ? this.queue[0]! : null;
      this.queue = head ? [head] : [];
      this.queued = head ? head.length : 0;
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
        if (n < head.length) {
          this.queue[0] = head.subarray(n);
          this.partial = true;
        } else {
          this.queue.shift();
          this.partial = false;
        }
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
