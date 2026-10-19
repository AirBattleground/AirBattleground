/**
 * Phase 6: whole-machine health for the admin dashboard. A 2 s sampler reads the host's /proc (HOST_PROC; in Docker the
 * host's /proc is mounted read-only at /host/proc, since the container's own /proc/net only sees the container) and
 * keeps the latest CPU / network rates. It starts on the first request and stops after a minute without one.
 */
import { readFile, statfs } from "node:fs/promises";
import { DEVICE_ONLINE_WINDOW_MS, type SystemHealth } from "@7xen/shared";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { storageRoot } from "../lib/storage.js";
import { internalAuthHeader } from "./media.js";

const SAMPLE_MS = 2_000;
const IDLE_STOP_MS = 60_000;
/** loopback, docker bridges, veths, tunnels — not real traffic in or out of the machine */
const VIRTUAL_IF = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|tun|tap|wg)/;

const proc = (p: string) => readFile(`${env.HOST_PROC}/${p}`, "utf8");

async function cpuTimes(): Promise<{ idle: number; total: number; cores: number }> {
  const lines = (await proc("stat")).split("\n");
  const f = lines[0]!.trim().split(/\s+/).slice(1).map(Number);
  const idle = (f[3] ?? 0) + (f[4] ?? 0); // idle + iowait
  const total = f.slice(0, 8).reduce((a, b) => a + b, 0); // user..steal (guest is already in user)
  return { idle, total, cores: lines.filter((l) => /^cpu\d+ /.test(l)).length };
}

async function netBytes(): Promise<{ rx: number; tx: number }> {
  // /proc/1/net/dev = the host's network namespace (PID 1 of the mounted host /proc)
  const text = await proc("1/net/dev").catch(() => proc("net/dev"));
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || VIRTUAL_IF.test(name!.trim())) continue;
    const n = rest.trim().split(/\s+/).map(Number);
    rx += n[0] ?? 0;
    tx += n[8] ?? 0;
  }
  return { rx, tx };
}

async function mediaIngest(): Promise<{ online: boolean; streams: number; bytes: number }> {
  try {
    const res = await fetch(`${env.MEDIA_API_URL}/v3/paths/list?itemsPerPage=1000`, { headers: { Authorization: internalAuthHeader() }, signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return { online: false, streams: 0, bytes: 0 };
    const { items = [] } = (await res.json()) as { items?: { ready?: boolean; bytesReceived?: number }[] };
    const live = items.filter((p) => p.ready);
    return { online: true, streams: live.length, bytes: live.reduce((a, p) => a + (p.bytesReceived ?? 0), 0) };
  } catch {
    return { online: false, streams: 0, bytes: 0 };
  }
}

interface Sample {
  at: number;
  cpu: { idle: number; total: number };
  net: { rx: number; tx: number };
  ingestBytes: number;
}

const state: {
  timer: NodeJS.Timeout | null;
  lastAsked: number;
  prev: Sample | null;
  rates: { cpuPct: number; netInBps: number; netOutBps: number; ingestBps: number; cores: number; liveStreams: number; mediaOnline: boolean };
} = { timer: null, lastAsked: 0, prev: null, rates: { cpuPct: 0, netInBps: 0, netOutBps: 0, ingestBps: 0, cores: 0, liveStreams: 0, mediaOnline: false } };

async function sample() {
  const [cpu, net, media] = await Promise.all([cpuTimes(), netBytes(), mediaIngest()]);
  const now = Date.now();
  const p = state.prev;
  if (p) {
    const secs = (now - p.at) / 1000;
    const dTotal = cpu.total - p.cpu.total;
    const rate = (cur: number, prev: number) => Math.max(0, ((cur - prev) * 8) / secs);
    state.rates = {
      cpuPct: dTotal > 0 ? Math.min(100, Math.max(0, (1 - (cpu.idle - p.cpu.idle) / dTotal) * 100)) : state.rates.cpuPct,
      netInBps: rate(net.rx, p.net.rx),
      netOutBps: rate(net.tx, p.net.tx),
      // a stream that just ended drops its bytes from the total; never report negative
      ingestBps: rate(media.bytes, p.ingestBytes),
      cores: cpu.cores,
      liveStreams: media.streams,
      mediaOnline: media.online,
    };
  } else {
    state.rates = { ...state.rates, cores: cpu.cores, liveStreams: media.streams, mediaOnline: media.online };
  }
  state.prev = { at: now, cpu, net, ingestBytes: media.bytes };
}

async function ensureSampler() {
  state.lastAsked = Date.now();
  if (state.timer) return;
  // two quick samples so the very first answer already has CPU / network rates
  await sample();
  await new Promise((r) => setTimeout(r, 400));
  await sample();
  state.timer = setInterval(() => {
    if (Date.now() - state.lastAsked > IDLE_STOP_MS) {
      clearInterval(state.timer!);
      state.timer = null;
      state.prev = null;
      return;
    }
    void sample().catch(() => undefined);
  }, SAMPLE_MS);
  state.timer.unref();
}

function meminfo(text: string) {
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0) * 1024;
  const total = kb("MemTotal");
  const available = kb("MemAvailable") || kb("MemFree");
  return { total, used: Math.max(0, total - available) };
}

export async function systemHealth(): Promise<SystemHealth> {
  await ensureSampler();
  const [mem, load, uptime, disk, devices] = await Promise.all([
    proc("meminfo").then(meminfo),
    proc("loadavg").then((t) => t.split(" ").slice(0, 3).map(Number)),
    proc("uptime").then((t) => Number(t.split(" ")[0])),
    statfs(storageRoot()).catch(() => statfs("/")),
    prisma.device.findMany({ select: { lastSeenAt: true } }),
  ]);
  const r = state.rates;
  const now = Date.now();
  return {
    cpuPct: Math.round(r.cpuPct * 10) / 10,
    cores: r.cores,
    load1: load[0] ?? 0,
    load5: load[1] ?? 0,
    load15: load[2] ?? 0,
    memUsedBytes: mem.used,
    memTotalBytes: mem.total,
    diskUsedBytes: (disk.blocks - disk.bfree) * disk.bsize,
    diskTotalBytes: disk.blocks * disk.bsize,
    netInBps: Math.round(r.netInBps),
    netOutBps: Math.round(r.netOutBps),
    uptimeSec: Math.round(uptime),
    liveStreams: r.liveStreams,
    ingestBps: Math.round(r.ingestBps),
    devicesOnline: devices.filter((d) => d.lastSeenAt && now - d.lastSeenAt.getTime() <= DEVICE_ONLINE_WINDOW_MS).length,
    devicesTotal: devices.length,
    mediaOnline: r.mediaOnline,
    at: new Date(now).toISOString(),
  };
}
