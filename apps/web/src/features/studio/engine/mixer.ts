/**
 * The Studio mixer: draws the on-air scene (plus overlays) onto a 1280×720 canvas 60×/s, mixes the audio of what's on
 * air with the host's mic, and — while live — records the result and sends it to the server in ~1 s chunks, in order.
 *
 * - The clock is a Web Worker timer, so the show keeps running when the tab is in the background (rAF would pause).
 * - Device streams come in through hls.js (the AWS device feed, or the box's own feed on a Studio Box — see `deviceUrl`); props are local video files; the webcam and
 *   mic come from getUserMedia.
 * - Audio: every source has a gain; sources on air are faded up, the rest down. Nothing plays on the speakers unless
 *   "monitor" is on (avoids echo into the host's mic).
 */
import type Hls from "hls.js";
import { deviceLiveUrl, STUDIO_FPS, STUDIO_HEIGHT as H, STUDIO_WIDTH as W, type MatchDetail } from "@7xen/shared";
import { getPropBlob } from "./props";
import { LAYOUTS, type Rect } from "./layouts";
import { DEFAULT_OVERLAYS, sourceKey, type Overlays, type Scene, type SourceRef } from "./types";

export interface MixerStatus {
  live: boolean;
  /** chunks waiting to upload */
  backlog: number;
  /** bytes/s actually uploaded (last few seconds) */
  uploadKbps: number;
  error: string | null;
  /** the recorder had to start over (server lost the session) */
  restarts: number;
  liveSince: number | null;
  /** video bitrate the recorder uses now (steps down when the upload can't keep up) */
  bitrateKbps: number;
  /** frames the mixer actually drew in the last second (target STUDIO_FPS) */
  fps: number;
}

/** Recorder video bitrates, best first. 6 Mbps keeps 720p60 game motion clean after the server re-encode; lower steps keep a weak upload live. */
const BITRATES = [6_000_000, 4_000_000, 2_500_000];
/**
 * Chunks (≈ seconds) waiting before we drop to a lower bitrate and jump back to live. Every restart cuts the
 * viewers' stream for a few seconds, so this is a last resort — short Wi-Fi spikes clear on their own (PARALLEL).
 */
const CATCH_UP_AT = 12;
/** at the lowest bitrate we only restart (jump back to live) when this far behind */
const GIVE_UP_AT = 25;
/** uploads in flight at once — the server reorders by seq, so a slow round trip doesn't stall the stream */
const PARALLEL = 3;

interface Src {
  ref: SourceRef;
  video: HTMLVideoElement | null;
  hls: Hls | null;
  gain: GainNode | null;
  stream: MediaStream | null;
  ready: boolean;
  error: string | null;
}

const FONT = "Rajdhani, Inter, system-ui, sans-serif";
const TEAL = "#2dd4c4";
const GOLD = "#f5c242";

function workerTicker(fps: number, onTick: () => void): () => void {
  const code = `let t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)});onmessage=()=>{clearInterval(t)}`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  const w = new Worker(url);
  w.onmessage = onTick;
  return () => {
    w.postMessage(0);
    w.terminate();
    URL.revokeObjectURL(url);
  };
}

function pickMime(): { mime: string; codec: "h264" | "vp8" | "vp9" } {
  // VP8/VP9 first: the server re-encodes to H.264 with steady keyframes (browser H.264 recordings have long GOPs)
  const options: { mime: string; codec: "h264" | "vp8" | "vp9" }[] = [
    { mime: "video/webm;codecs=vp8,opus", codec: "vp8" },
    { mime: "video/webm;codecs=vp9,opus", codec: "vp9" },
    { mime: "video/webm;codecs=h264,opus", codec: "h264" },
    { mime: "video/webm", codec: "vp8" },
  ];
  return options.find((o) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o.mime)) ?? options[3]!;
}

const newSession = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

let nextId = 1;

export class StudioMixer {
  readonly id = nextId++;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audio: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private monitor: GainNode;
  private sources = new Map<string, Src>();
  private stopTicker: (() => void) | null = null;

  private program: Scene | null = null;
  private previous: Scene | null = null;
  private transitionStart = 0;
  private transitionMs = 0;
  overlays: Overlays = { ...DEFAULT_OVERLAYS };
  /**
   * Where a device source's HLS comes from. Default: the AWS device feed. On a Studio Box (phase 8c) the console and
   * the render page set it to the box's same-origin feed (BoxDevice.hlsUrl). Set it before sources are prepared.
   */
  deviceUrl: (id: string) => string = deviceLiveUrl;
  private overlayImg: HTMLImageElement | null = null;
  private match: MatchDetail | null = null;
  private orgName = "";

  private mic: { stream: MediaStream; node: MediaStreamAudioSourceNode; gain: GainNode; analyser: AnalyserNode } | null = null;
  private recorder: MediaRecorder | null = null;
  private showId: string | null = null;
  private session = "";
  private seq = 0;
  private queue: { session: string; seq: number; blob: Blob; sending: boolean }[] = [];
  private inFlight = 0;
  /** the server accepted seq 0 of this session — until then only that chunk may be in flight (it opens the session) */
  private opened = false;
  private rate = 0;
  private lastStepDown = 0;
  private sentBytes: { at: number; bytes: number }[] = [];
  private codec: "h264" | "vp8" | "vp9" = "vp8";
  /** capture mode (Studio worker render page): records the program locally and hands chunks over, in order */
  private captureRec: MediaRecorder | null = null;
  private captureChain: Promise<void> = Promise.resolve();
  /** chunks handed over successfully since startCapture (and the last hand-over error) */
  capture = { recording: false, error: null as string | null };
  /** LIVE-bug clock while the show is on air somewhere else (a Studio worker) — this mixer itself isn't live */
  private clockSince: number | null = null;
  status: MixerStatus = { live: false, backlog: 0, uploadKbps: 0, error: null, restarts: 0, liveSince: null, bitrateKbps: BITRATES[0]! / 1000, fps: 0 };
  onStatus: ((s: MixerStatus) => void) | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.audio = new AudioContext();
    this.dest = this.audio.createMediaStreamDestination();
    // a silent source keeps the mix's audio track producing samples even when nothing on air has sound — without it
    // MediaRecorder (VP8 + Opus) emits no data at all in headless Chrome (Studio worker)
    const silence = this.audio.createConstantSource();
    const mute = this.audio.createGain();
    mute.gain.value = 0;
    silence.connect(mute).connect(this.dest);
    silence.start();
    this.monitor = this.audio.createGain();
    this.monitor.gain.value = 0;
    this.monitor.connect(this.audio.destination);
    let frames = 0;
    let since = performance.now();
    this.stopTicker = workerTicker(STUDIO_FPS, () => {
      this.draw();
      frames++;
      // measure the real frame rate and refresh the UI (clock, upload rate) about once a second
      const now = performance.now();
      if (now - since >= 1000) {
        this.status.fps = Math.round((frames * 1000) / (now - since));
        frames = 0;
        since = now;
        if (this.status.live) this.emit();
      }
    });
  }

  dispose() {
    this.stopTicker?.();
    this.recorder?.state !== "inactive" && this.recorder?.stop();
    this.stopCapture();
    for (const s of this.sources.values()) this.dropSource(s);
    this.mic?.stream.getTracks().forEach((t) => t.stop());
    void this.audio.close();
  }

  // ---------------------------------------------------------------- sources

  /** Make sure every source a scene needs is loaded (device feeds, props, camera). */
  async prepare(refs: (SourceRef | null)[]) {
    // resume() can stay pending forever where there's no audio output (headless Chrome on a Studio worker) — don't let
    // that hold up the picture; the audio engine is nudged again later (resumeAudio)
    if (this.audio.state === "suspended") await Promise.race([this.audio.resume().catch(() => undefined), new Promise((r) => setTimeout(r, 500))]);
    await Promise.all(refs.filter((r): r is SourceRef => !!r).map((r) => this.ensure(r)));
  }

  private async ensure(ref: SourceRef): Promise<Src> {
    const key = sourceKey(ref);
    const have = this.sources.get(key);
    if (have) return have;
    const src: Src = { ref, video: null, hls: null, gain: null, stream: null, ready: false, error: null };
    this.sources.set(key, src);
    if (ref.kind === "device" || ref.kind === "prop" || ref.kind === "camera") {
      const v = document.createElement("video");
      v.playsInline = true;
      v.muted = ref.kind === "camera"; // camera audio comes via the mic channel
      v.crossOrigin = "anonymous";
      src.video = v;
      if (ref.kind !== "camera") {
        const node = this.audio.createMediaElementSource(v);
        src.gain = this.audio.createGain();
        src.gain.gain.value = 0;
        node.connect(src.gain);
        src.gain.connect(this.dest);
        src.gain.connect(this.monitor);
      }
      try {
        if (ref.kind === "device") await this.attachHls(src, this.deviceUrl(ref.id));
        else if (ref.kind === "prop") {
          const blob = await getPropBlob(ref.id);
          if (!blob) throw new Error("This prop video isn't in this browser any more");
          v.src = URL.createObjectURL(blob);
          v.loop = true;
        } else {
          src.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
          v.srcObject = src.stream;
        }
        await v.play().catch(() => undefined);
        src.ready = true;
      } catch (e) {
        src.error = e instanceof Error ? e.message : "Couldn't open this source";
      }
    } else {
      src.ready = true;
    }
    return src;
  }

  private async attachHls(src: Src, url: string) {
    const v = src.video!;
    const { default: HlsCtor } = await import("hls.js");
    if (HlsCtor.isSupported()) {
      const h = new HlsCtor({ lowLatencyMode: true, liveSyncDurationCount: 2, maxLiveSyncPlaybackRate: 1.5, xhrSetup: (xhr) => {
        xhr.withCredentials = true;
      } });
      src.hls = h;
      h.loadSource(url);
      h.attachMedia(v);
      h.on(HlsCtor.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        src.error = "The phone's video dropped — retrying…";
        window.setTimeout(() => {
          h.loadSource(url);
          h.startLoad();
        }, 3000);
      });
      h.on(HlsCtor.Events.FRAG_LOADED, () => (src.error = null));
    } else {
      v.src = url;
    }
  }

  private dropSource(s: Src) {
    s.hls?.destroy();
    s.stream?.getTracks().forEach((t) => t.stop());
    if (s.video) {
      s.video.pause();
      if (s.video.src.startsWith("blob:")) URL.revokeObjectURL(s.video.src);
      s.video.removeAttribute("src");
      s.video.load();
    }
    s.gain?.disconnect();
  }

  sourceState(ref: SourceRef): { ready: boolean; error: string | null } {
    const s = this.sources.get(sourceKey(ref));
    return { ready: !!s?.ready, error: s?.error ?? null };
  }

  /** The <video> of a source (for thumbnails in the UI). */
  videoOf(ref: SourceRef): HTMLVideoElement | null {
    return this.sources.get(sourceKey(ref))?.video ?? null;
  }

  /** Wake the audio engine (a worker's Chrome allows this without a click). */
  async resumeAudio() {
    if (this.audio.state === "suspended") await this.audio.resume().catch(() => undefined);
  }

  // ---------------------------------------------------------------- mic

  async setMic(deviceId: string | null) {
    if (this.mic) {
      this.mic.stream.getTracks().forEach((t) => t.stop());
      this.mic.node.disconnect();
      this.mic = null;
    }
    if (deviceId === null) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const node = this.audio.createMediaStreamSource(stream);
    const gain = this.audio.createGain();
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 512;
    node.connect(gain);
    gain.connect(analyser);
    gain.connect(this.dest);
    this.mic = { stream, node, gain, analyser };
  }

  setMicMuted(muted: boolean) {
    if (this.mic) this.mic.gain.gain.setTargetAtTime(muted ? 0 : 1, this.audio.currentTime, 0.05);
  }

  /** 0..1 loudness of the mic (for the level meter). */
  micLevel(): number {
    if (!this.mic) return 0;
    const buf = new Uint8Array(this.mic.analyser.fftSize);
    this.mic.analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const b of buf) peak = Math.max(peak, Math.abs(b - 128));
    return Math.min(1, peak / 100);
  }

  setMonitor(on: boolean) {
    this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.audio.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- program

  /** Put a scene on air (cut, or fade over `fadeMs`). */
  async take(scene: Scene, fadeMs: number) {
    await this.prepare(scene.slots);
    this.previous = this.program;
    this.program = scene;
    this.transitionStart = performance.now();
    this.transitionMs = this.previous ? fadeMs : 0;
    // audio follows the picture: on-air sources up, everything else down
    const onAir = new Set(scene.slots.filter((s): s is SourceRef => !!s).map(sourceKey));
    const ramp = Math.max(0.05, fadeMs / 1000 / 3);
    for (const [key, s] of this.sources) {
      s.gain?.gain.setTargetAtTime(onAir.has(key) ? 1 : 0, this.audio.currentTime, ramp);
      if (s.video && onAir.has(key) && s.ref.kind === "prop") {
        s.video.currentTime = 0;
        void s.video.play().catch(() => undefined);
      }
    }
  }

  get onAir(): Scene | null {
    return this.program;
  }

  setMatch(m: MatchDetail | null, orgName: string) {
    this.match = m;
    this.orgName = orgName;
  }

  setOverlayImage(img: HTMLImageElement | null) {
    this.overlayImg = img;
  }

  // ---------------------------------------------------------------- drawing

  /** Draw one scene into `ctx` (also used for the preview monitor). */
  drawScene(ctx: CanvasRenderingContext2D, scene: Scene | null) {
    ctx.fillStyle = "#06090c";
    ctx.fillRect(0, 0, W, H);
    if (!scene) {
      this.drawSlate(ctx, { x: 0, y: 0, w: W, h: H }, "Pick a scene to go on air");
      return;
    }
    const lay = LAYOUTS[scene.layout];
    if (lay.rects.some((r) => r.framed)) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#0b1a1d");
      g.addColorStop(1, "#05080a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    lay.rects.forEach((r, i) => this.drawSlot(ctx, scene.slots[i] ?? null, r));
  }

  private drawSlot(ctx: CanvasRenderingContext2D, ref: SourceRef | null, r: Rect) {
    ctx.save();
    if (r.framed) {
      roundRect(ctx, r, 12);
      ctx.clip();
    }
    if (!ref) {
      ctx.fillStyle = "#11181c";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      label(ctx, "Empty slot", r);
    } else if (ref.kind === "scorecard") this.drawScorecard(ctx, r);
    else if (ref.kind === "mvp") this.drawMvp(ctx, r);
    else if (ref.kind === "slate") this.drawSlate(ctx, r, "Starting soon");
    else {
      const s = this.sources.get(sourceKey(ref));
      const v = s?.video;
      if (v && v.readyState >= 2 && v.videoWidth) drawCover(ctx, v, r, ref.kind === "camera");
      else {
        ctx.fillStyle = "#0d1418";
        ctx.fillRect(r.x, r.y, r.w, r.h);
        label(ctx, s?.error ?? (ref.kind === "device" ? "Waiting for the phone's video…" : "Loading…"), r);
      }
    }
    ctx.restore();
    if (r.framed) {
      ctx.save();
      ctx.strokeStyle = "rgba(45,212,196,0.55)";
      ctx.lineWidth = 2;
      roundRect(ctx, r, 12);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawSlate(ctx: CanvasRenderingContext2D, r: Rect, text: string) {
    const g = ctx.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, 20, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.7);
    g.addColorStop(0, "#0f3b3a");
    g.addColorStop(1, "#04070a");
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = TEAL;
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.round(r.h * 0.035)}px ${FONT}`;
    ctx.fillText((this.orgName || "AIRBATTLEGROUND").toUpperCase(), r.x + r.w / 2, r.y + r.h * 0.4);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(r.h * 0.12)}px ${FONT}`;
    ctx.fillText(text.toUpperCase(), r.x + r.w / 2, r.y + r.h * 0.55);
    ctx.textAlign = "left";
  }

  private drawScorecard(ctx: CanvasRenderingContext2D, r: Rect) {
    ctx.fillStyle = "rgba(6,12,14,0.96)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const m = this.match;
    const s = r.h / H; // scale to slot
    const pad = 36 * s;
    ctx.fillStyle = TEAL;
    ctx.font = `700 ${18 * s}px ${FONT}`;
    ctx.fillText(m ? `${m.scrim.title.toUpperCase()} · MATCH ${m.match.number} · ${m.match.map}` : "SCORECARD", r.x + pad, r.y + pad + 10 * s);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${44 * s}px ${FONT}`;
    ctx.fillText("MATCH STANDINGS", r.x + pad, r.y + pad + 56 * s);
    if (!m) {
      label(ctx, "Pick the show's match to show its scorecard", r);
      return;
    }
    const rows = m.teams
      .filter((t) => t.team)
      .map((t) => ({ name: t.team!.name, tag: t.team!.tag, place: t.placement, kills: t.kills ?? 0, pts: t.totalPoints }))
      .sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || (a.place ?? 99) - (b.place ?? 99) || b.kills - a.kills)
      .slice(0, 12);
    const top = r.y + pad + 92 * s;
    const rowH = Math.min(40 * s, (r.h - (top - r.y) - pad) / Math.max(rows.length + 1, 1));
    const cols = [r.x + pad, r.x + pad + 70 * s, r.x + r.w - pad - 300 * s, r.x + r.w - pad - 170 * s, r.x + r.w - pad - 40 * s];
    ctx.font = `700 ${15 * s}px ${FONT}`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ["#", "TEAM", "PLACE", "KILLS", "PTS"].forEach((h, i) => ctx.fillText(h, cols[i]!, top));
    rows.forEach((row, i) => {
      const y = top + rowH * (i + 1);
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(45,212,196,0.07)";
        ctx.fillRect(r.x + pad - 10 * s, y - rowH * 0.7, r.w - 2 * pad + 20 * s, rowH);
      }
      ctx.fillStyle = i === 0 ? GOLD : "#fff";
      ctx.font = `700 ${22 * s}px ${FONT}`;
      ctx.fillText(String(i + 1), cols[0]!, y);
      ctx.fillText(`${row.name}`.slice(0, 28), cols[1]!, y);
      ctx.fillText(row.place != null ? `#${row.place}` : "—", cols[2]!, y);
      ctx.fillText(String(row.kills), cols[3]!, y);
      ctx.fillText(row.pts != null ? String(row.pts) : "—", cols[4]! - 10 * s, y);
    });
  }

  private drawMvp(ctx: CanvasRenderingContext2D, r: Rect) {
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
    g.addColorStop(0, "#1b1503");
    g.addColorStop(1, "#05080a");
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const s = r.h / H;
    let best: { name: string; team: string; kills: number } | null = null;
    for (const t of this.match?.teams ?? []) {
      for (const p of t.players) {
        const k = p.kills ?? 0;
        if (!best || k > best.kills) best = { name: p.name, team: t.team?.name ?? `Slot ${t.slotNumber}`, kills: k };
      }
    }
    ctx.textAlign = "center";
    ctx.fillStyle = GOLD;
    ctx.font = `700 ${30 * s}px ${FONT}`;
    ctx.fillText("★ MATCH MVP ★", r.x + r.w / 2, r.y + r.h * 0.28);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${96 * s}px ${FONT}`;
    ctx.fillText(best ? best.name : "—", r.x + r.w / 2, r.y + r.h * 0.5);
    ctx.fillStyle = TEAL;
    ctx.font = `700 ${34 * s}px ${FONT}`;
    ctx.fillText(best ? best.team.toUpperCase() : "Waiting for match results", r.x + r.w / 2, r.y + r.h * 0.62);
    if (best) {
      ctx.fillStyle = GOLD;
      ctx.font = `700 ${120 * s}px ${FONT}`;
      ctx.fillText(String(best.kills), r.x + r.w / 2, r.y + r.h * 0.85);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `700 ${22 * s}px ${FONT}`;
      ctx.fillText("FINISHES", r.x + r.w / 2, r.y + r.h * 0.92);
    }
    ctx.textAlign = "left";
  }

  private drawOverlays(ctx: CanvasRenderingContext2D) {
    const o = this.overlays;
    if (o.layout && this.overlayImg?.complete) ctx.drawImage(this.overlayImg, 0, 0, W, H);
    const since = this.status.live ? this.status.liveSince : this.clockSince;
    if (o.liveBug && (this.status.live || this.clockSince !== null)) {
      const secs = since ? Math.floor((Date.now() - since) / 1000) : 0;
      const t = `${String(Math.floor(secs / 3600)).padStart(1, "0")}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
      ctx.fillStyle = "#e5252a";
      ctx.fillRect(W - 210, 22, 80, 34);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(W - 130, 22, 108, 34);
      ctx.fillStyle = "#fff";
      ctx.font = `700 22px ${FONT}`;
      ctx.fillText("● LIVE", W - 202, 47);
      ctx.fillText(t, W - 120, 47);
    }
    if (o.lowerThird && o.lowerTitle.trim()) {
      const y = H - (o.ticker ? 150 : 110);
      ctx.fillStyle = TEAL;
      ctx.fillRect(40, y, 8, 64);
      ctx.fillStyle = "rgba(4,10,12,0.88)";
      ctx.fillRect(48, y, Math.max(320, 22 * o.lowerTitle.length), 64);
      ctx.fillStyle = "#fff";
      ctx.font = `700 30px ${FONT}`;
      ctx.fillText(o.lowerTitle, 64, y + 32);
      ctx.fillStyle = TEAL;
      ctx.font = `600 18px ${FONT}`;
      ctx.fillText(o.lowerSubtitle.toUpperCase(), 64, y + 54);
    }
    if (o.ticker && o.tickerText.trim()) {
      ctx.fillStyle = "rgba(4,10,12,0.92)";
      ctx.fillRect(0, H - 44, W, 44);
      ctx.fillStyle = "#e5252a";
      ctx.fillRect(0, H - 44, 96, 44);
      ctx.fillStyle = "#fff";
      ctx.font = `700 20px ${FONT}`;
      ctx.fillText("LIVE", 24, H - 15);
      const text = `${o.tickerText}   ◆   `;
      const w = ctx.measureText(text).width;
      const off = ((performance.now() / 1000) * 90) % w;
      ctx.save();
      ctx.beginPath();
      ctx.rect(100, H - 44, W - 100, 44);
      ctx.clip();
      for (let x = 110 - off; x < W; x += w) ctx.fillText(text, x, H - 15);
      ctx.restore();
    }
  }

  private draw() {
    const ctx = this.ctx;
    const now = performance.now();
    const t = this.transitionMs ? Math.min(1, (now - this.transitionStart) / this.transitionMs) : 1;
    if (t < 1 && this.previous) {
      this.drawScene(ctx, this.previous);
      ctx.globalAlpha = t;
      this.drawScene(ctx, this.program);
      ctx.globalAlpha = 1;
    } else {
      this.drawScene(ctx, this.program);
    }
    this.drawOverlays(ctx);
  }

  /**
   * A still of what's on air for the match screenshot reader: the program scene at 1920×1080 (sharper text than the
   * 720p stream), WITHOUT the studio's own graphics (LIVE bug, lower third, ticker) so they can't cover the scores.
   */
  snapshot(): Promise<Blob> {
    const c = document.createElement("canvas");
    c.width = 1920;
    c.height = 1080;
    const ctx = c.getContext("2d", { alpha: false })!;
    ctx.setTransform(c.width / W, 0, 0, c.height / H, 0, 0);
    this.drawScene(ctx, this.program);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't take the screenshot"))), "image/png"));
  }

  /** Show the LIVE bug + clock from `since` (ms) although this mixer isn't uploading (the show runs on a worker); null hides it. */
  setLiveClock(since: number | null) {
    this.clockSince = since;
  }

  // ---------------------------------------------------------------- capture (Studio worker)

  /**
   * Record the program (canvas + audio mix) without uploading it: every `timesliceMs` a chunk goes to `onChunk`.
   * Chunks are handed over strictly in order — the next one waits until the previous `onChunk` has finished.
   */
  startCapture(opts: { bitsPerSecond: number; timesliceMs: number; onChunk: (b: Blob) => void | Promise<void> }) {
    if (this.captureRec) return;
    // H.264 when the browser can record it: about a third less CPU than VP8 on the worker's headless Chrome (and cheaper
    // for its ffmpeg to decode). The worker re-encodes either way, so the codec here doesn't change the broadcast.
    const h264 = "video/webm;codecs=h264,opus";
    const mime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(h264) ? h264 : pickMime().mime;
    const stream = new MediaStream([...this.canvas.captureStream(STUDIO_FPS).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitsPerSecond, audioBitsPerSecond: 192_000 });
    this.captureChain = Promise.resolve();
    this.capture = { recording: false, error: null };
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      const blob = e.data;
      this.captureChain = this.captureChain
        .then(() => opts.onChunk(blob))
        .then(
          () => {
            if (this.captureRec === rec) this.capture = { recording: true, error: null };
          },
          (err: unknown) => {
            this.capture = { recording: false, error: err instanceof Error ? err.message : "Couldn't hand the video over" };
          },
        );
    };
    rec.onerror = () => {
      this.capture = { recording: false, error: "The recorder stopped" };
    };
    rec.start(opts.timesliceMs);
    this.captureRec = rec;
  }

  stopCapture() {
    const rec = this.captureRec;
    this.captureRec = null;
    if (rec && rec.state !== "inactive") rec.stop();
    rec?.stream.getVideoTracks().forEach((t) => t.stop());
    this.capture = { ...this.capture, recording: false };
  }

  get capturing(): boolean {
    return !!this.captureRec;
  }

  // ---------------------------------------------------------------- going live

  /** Start recording + sending the program to the show. */
  goLive(showId: string) {
    if (this.status.live) return;
    this.showId = showId;
    this.rate = 0;
    this.status = { ...this.status, live: true, error: null, liveSince: Date.now(), bitrateKbps: BITRATES[0]! / 1000 };
    this.startRecorder();
    this.emit();
  }

  private startRecorder() {
    const { mime, codec } = pickMime();
    this.codec = codec;
    this.session = newSession();
    this.seq = 0;
    this.opened = false;
    const stream = new MediaStream([...this.canvas.captureStream(STUDIO_FPS).getVideoTracks(), ...this.dest.stream.getAudioTracks()]);
    const bitrate = BITRATES[this.rate]!;
    this.status.bitrateKbps = bitrate / 1000;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 128_000 });
    const session = this.session;
    rec.ondataavailable = (e) => {
      if (!e.data.size || session !== this.session) return;
      this.queue.push({ session, seq: this.seq++, blob: e.data, sending: false });
      this.catchUp();
      this.pump();
    };
    rec.start(1000);
    this.recorder = rec;
  }

  /** The upload is falling behind: start a fresh recorder session at a lower bitrate and drop what's queued (back to live). */
  private catchUp() {
    if (!this.status.live || this.queue.length < CATCH_UP_AT) return;
    const lowest = this.rate >= BITRATES.length - 1;
    if (lowest && this.queue.length < GIVE_UP_AT) return;
    if (Date.now() - this.lastStepDown < 20_000) return;
    this.lastStepDown = Date.now();
    this.rate = Math.min(this.rate + 1, BITRATES.length - 1);
    this.queue = [];
    const old = this.recorder;
    this.recorder = null;
    if (old && old.state !== "inactive") old.stop();
    this.status.restarts++;
    this.startRecorder();
  }

  /** Send queued chunks, up to PARALLEL at once. */
  private pump() {
    while (this.showId && this.inFlight < (this.opened ? PARALLEL : 1)) {
      const c = this.queue.find((x) => !x.sending);
      if (!c) break;
      if (c.session !== this.session) {
        this.queue = this.queue.filter((x) => x !== c);
        continue;
      }
      c.sending = true;
      this.inFlight++;
      void this.send(c).finally(() => {
        this.inFlight--;
        this.emit();
        this.pump();
      });
    }
  }

  private async send(c: { session: string; seq: number; blob: Blob; sending: boolean }) {
    const res = await fetch(`/api/manager/studio/shows/${this.showId}/ingest?session=${c.session}&seq=${c.seq}&codec=${this.codec}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "video/webm" },
      body: c.blob,
    }).catch(() => null);
    if (c.session !== this.session) return; // a newer session took over while this was in flight
    if (res?.ok) {
      this.opened = true;
      this.queue = this.queue.filter((x) => x !== c);
      this.sentBytes.push({ at: Date.now(), bytes: c.blob.size });
      this.status.error = null;
    } else if (res?.status === 409) {
      // the server lost this session (restart / crash): begin a fresh recording
      this.queue = [];
      const old = this.recorder;
      this.recorder = null;
      if (old && old.state !== "inactive") old.stop();
      this.status.restarts++;
      if (this.status.live) this.startRecorder();
    } else {
      this.status.error = res ? `Upload failed (${res.status}). Retrying…` : "Connection lost. Retrying…";
      this.emit();
      await new Promise((r) => setTimeout(r, 1500));
      c.sending = false;
    }
  }

  async endLive() {
    if (!this.status.live) return;
    this.status = { ...this.status, live: false };
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    // let the last chunk(s) go out, then tell the server the show is over
    for (let i = 0; i < 10 && this.queue.length; i++) await new Promise((r) => setTimeout(r, 300));
    if (this.showId) await fetch(`/api/manager/studio/shows/${this.showId}/stop`, { method: "POST", credentials: "include" }).catch(() => undefined);
    this.queue = [];
    this.status.liveSince = null;
    this.emit();
  }

  private emit() {
    const cut = Date.now() - 4000;
    this.sentBytes = this.sentBytes.filter((x) => x.at >= cut);
    const bytes = this.sentBytes.reduce((n, x) => n + x.bytes, 0);
    this.status = { ...this.status, backlog: this.queue.length, uploadKbps: Math.round((bytes * 8) / 4 / 1000) };
    this.onStatus?.(this.status);
  }
}

// ---------------------------------------------------------------- canvas helpers

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, rad: number) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, r: Rect, mirror: boolean) {
  const vr = v.videoWidth / v.videoHeight;
  const rr = r.w / r.h;
  let sw = v.videoWidth;
  let sh = v.videoHeight;
  if (vr > rr) sw = sh * rr;
  else sh = sw / rr;
  const sx = (v.videoWidth - sw) / 2;
  const sy = (v.videoHeight - sh) / 2;
  if (mirror) {
    ctx.save();
    ctx.translate(r.x + r.w, r.y);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, r.w, r.h);
    ctx.restore();
  } else ctx.drawImage(v, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
}

function label(ctx: CanvasRenderingContext2D, text: string, r: Rect) {
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textAlign = "center";
  ctx.font = `600 ${Math.max(14, Math.round(r.h * 0.045))}px ${FONT}`;
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
  ctx.textAlign = "left";
}
