import type { RenderStatus, WorkerJob, WorkerPollInput, WorkerPollResponse } from "@7xen/shared";
import { describe, expect, it } from "vitest";
import type { PollResult } from "../src/api.js";
import { backoffMs, JobRunner, type PipelineHooks, type StartPipeline } from "../src/job.js";
import { makePollStep } from "../src/loop.js";

const job = (showId: string, token = "t"): WorkerJob => ({
  showId,
  title: `Show ${showId}`,
  renderUrl: `https://x/studio-render/${showId}`,
  session: { cookieName: "sid", token: "s" },
  publishUrl: `rtmp://x/live/show_${showId}?wtoken=${token}`,
  videoKbps: 6000,
  fps: 60,
});

function fakes() {
  let t = 0;
  const started: { job: WorkerJob; hooks: PipelineHooks; stopped: boolean }[] = [];
  let failNext = false;
  const start: StartPipeline = async (j, hooks) => {
    if (failNext) {
      failNext = false;
      throw new Error("Chrome not found");
    }
    const entry = { job: j, hooks, stopped: false };
    started.push(entry);
    return { kbps: () => 6000, stop: async () => void (entry.stopped = true) };
  };
  const runner = new JobRunner(start, { now: () => t });
  return {
    runner,
    started,
    advance: (ms: number) => (t += ms),
    failNextStart: () => (failNext = true),
    last: () => started[started.length - 1]!,
  };
}

describe("JobRunner", () => {
  it("starts, goes live on the first chunk, stops on null", async () => {
    const f = fakes();
    await f.runner.setJob(job("a"));
    expect(f.runner.state).toBe("starting");
    f.last().hooks.chunk();
    f.last().hooks.status({ fps: 59, recording: true, error: null } satisfies RenderStatus);
    expect(f.runner.snapshot()).toEqual({ state: "live", showId: "a", fps: 59, bitrateKbps: 6000, error: null });
    await f.runner.setJob(job("a", "fresh")); // same show: keep running
    expect(f.started).toHaveLength(1);
    expect(f.runner.job?.publishUrl).toContain("fresh");
    await f.runner.setJob(null);
    expect(f.last().stopped).toBe(true);
    expect(f.runner.snapshot()).toMatchObject({ state: "idle", showId: null, fps: null, bitrateKbps: null });
  });

  it("waits for ffmpeg to send before reporting live", async () => {
    let flowing = false;
    const r = new JobRunner(async (_j, hooks) => {
      queueMicrotask(() => hooks.chunk());
      return { kbps: () => null, flowing: () => flowing, stop: async () => {} };
    });
    await r.setJob(job("a"));
    await r.tick();
    expect(r.state).toBe("starting");
    flowing = true;
    await r.tick();
    expect(r.state).toBe("live");
  });

  it("switches shows", async () => {
    const f = fakes();
    await f.runner.setJob(job("a"));
    await f.runner.setJob(job("b"));
    expect(f.started.map((s) => [s.job.showId, s.stopped])).toEqual([["a", true], ["b", false]]);
  });

  it("restarts after a stall with backoff, using the latest job", async () => {
    const f = fakes();
    await f.runner.setJob(job("a"));
    f.last().hooks.chunk();
    f.advance(5000);
    await f.runner.tick();
    expect(f.runner.state).toBe("live");
    f.advance(10_001);
    await f.runner.tick();
    expect(f.runner.state).toBe("error");
    expect(f.runner.error).toMatch(/No video/);
    expect(f.last().stopped).toBe(true);
    await f.runner.setJob(job("a", "t2"));
    f.advance(1000);
    await f.runner.tick();
    expect(f.started).toHaveLength(1); // still backing off (2 s)
    f.advance(1000);
    await f.runner.tick();
    expect(f.started).toHaveLength(2);
    expect(f.last().job.publishUrl).toContain("t2");
    expect(f.runner.state).toBe("starting");
  });

  it("gives a fresh start 30 s for its first chunk", async () => {
    const f = fakes();
    await f.runner.setJob(job("a"));
    f.advance(20_000);
    await f.runner.tick();
    expect(f.runner.state).toBe("starting");
    f.advance(10_001);
    await f.runner.tick();
    expect(f.runner.state).toBe("error");
  });

  it("restarts when ffmpeg/Chrome exits, ignores exits of old pipelines", async () => {
    const f = fakes();
    await f.runner.setJob(job("a"));
    const first = f.last();
    first.hooks.exit("ffmpeg stopped (code 1)");
    await f.runner.tick();
    expect(f.runner.snapshot()).toMatchObject({ state: "error", error: "ffmpeg stopped (code 1)" });
    f.advance(2000);
    await f.runner.tick();
    expect(f.started).toHaveLength(2);
    first.hooks.exit("late exit"); // stale
    first.hooks.chunk();
    await f.runner.tick();
    expect(f.runner.state).toBe("starting");
  });

  it("start failures back off 2, 4, 8 … 30 s", async () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
    const f = fakes();
    f.failNextStart();
    await f.runner.setJob(job("a"));
    expect(f.runner.snapshot()).toMatchObject({ state: "error", error: "Chrome not found", showId: "a" });
    f.failNextStart();
    f.advance(2000);
    await f.runner.tick();
    f.advance(3999);
    await f.runner.tick();
    expect(f.started).toHaveLength(0);
    f.advance(1);
    await f.runner.tick();
    expect(f.started).toHaveLength(1);
  });
});

describe("poll step", () => {
  const worker = { id: "w1", name: "Gaming PC" };
  function setup(results: PollResult[]) {
    let t = 0;
    const f = fakes();
    const sent: WorkerPollInput[] = [];
    const step = makePollStep({
      poll: async (b) => (sent.push(b), results.shift() ?? { kind: "error", message: "down" }),
      runner: f.runner,
      version: "0.1.0",
      encoder: "libx264",
      now: () => t,
    });
    return { f, step, sent, advance: (ms: number) => (t += ms) };
  }
  const ok = (j: WorkerJob | null): PollResult => ({ kind: "ok", res: { worker, job: j } satisfies WorkerPollResponse });

  it("applies the job and reports state", async () => {
    const s = setup([ok(job("a")), ok(job("a"))]);
    expect(await s.step()).toBe(2000);
    await s.f.runner.tick();
    expect(s.f.runner.state).toBe("starting");
    await s.step();
    expect(s.sent[1]).toMatchObject({ version: "0.1.0", encoder: "libx264", state: "starting", showId: "a" });
  });

  it("401 → stop and retry slowly", async () => {
    const s = setup([ok(job("a")), { kind: "unauthorized" }]);
    await s.step();
    expect(await s.step()).toBe(30_000);
    expect(s.f.runner.state).toBe("idle");
  });

  it("keeps the show through a short outage, stops after 60 s", async () => {
    const s = setup([ok(job("a"))]);
    await s.step();
    s.advance(30_000);
    await s.step();
    expect(s.f.runner.job?.showId).toBe("a");
    s.advance(31_000);
    await s.step();
    expect(s.f.runner.job).toBeNull();
    expect(s.f.last().stopped).toBe(true);
  });
});
