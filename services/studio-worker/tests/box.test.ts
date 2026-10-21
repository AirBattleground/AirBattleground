import type { WorkerJob, WorkerPollInput } from "@7xen/shared";
import { describe, expect, it } from "vitest";
import { escapeTeeUrl, ffmpegArgs, outputArgs, teeTarget } from "../src/encoder.js";
import { redactKeys } from "../src/ffmpeg.js";
import { JobRunner } from "../src/job.js";
import { makePollStep } from "../src/loop.js";
import { publishPlan } from "../src/pipeline.js";

const O = { fps: 60, kbps: 6000, cores: 8 };
const AWS = "rtmp://airbattleground.com:1935/live/show_abc12345?wtoken=1.sig";
const job = (extra: Partial<WorkerJob> = {}): WorkerJob => ({
  showId: "abc12345",
  title: "Show",
  renderUrl: "http://192.168.1.20:4300/studio-render/abc12345",
  session: { cookieName: "sx_app", token: "t" },
  publishUrl: AWS,
  videoKbps: 6000,
  fps: 60,
  ...extra,
});
const YT = { id: "yt", name: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2/abcd-efgh-ijkl" };
const KEY = { id: "k1", name: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp/FB-123?s_bl=1&a=b" };

describe("tee arguments", () => {
  it("escapes the tee separators and quoting", () => {
    expect(escapeTeeUrl("rtmp://h/app/k|ey'x[1]\\")).toBe("rtmp://h/app/k\\|ey\\'x\\[1\\]\\\\");
    expect(escapeTeeUrl("rtmp://h/live2/abc-DEF_1?x=1&y=2")).toBe("rtmp://h/live2/abc-DEF_1?x=1&y=2");
  });

  it("every slave is FLV with onfail=ignore, joined by |", () => {
    const t = teeTarget([YT.url, "rtmp://h/a/b|c"]);
    expect(t).toBe(`[f=flv:onfail=ignore:flvflags=no_duration_filesize]${YT.url}|[f=flv:onfail=ignore:flvflags=no_duration_filesize]rtmp://h/a/b\\|c`);
    expect(t.split(/(?<!\\)\|/)).toHaveLength(2);
  });

  it("one URL stays plain FLV (phase 8b unchanged), several → tee with global headers, none → null muxer", () => {
    const single = ffmpegArgs("libx264", { ...O, output: AWS });
    expect(single.slice(-5)).toEqual(["-flvflags", "no_duration_filesize", "-f", "flv", AWS]);
    expect(ffmpegArgs("libx264", { ...O, output: [AWS] })).toEqual(single);
    const tee = ffmpegArgs("libx264", { ...O, output: [YT.url, AWS] });
    expect(tee.slice(-5)).toEqual(["-flags", "+global_header", "-f", "tee", teeTarget([YT.url, AWS])]);
    expect(tee).not.toContain("flv");
    expect(outputArgs([YT.url], true)).toEqual(["-flags", "+global_header", "-f", "tee", teeTarget([YT.url])]);
    expect(outputArgs([])).toEqual(["-f", "null", "-"]);
  });
});

describe("publishPlan", () => {
  it("no outputs field → publishUrl (or its PUBLISH_RTMP_BASE rewrite), as before", () => {
    expect(publishPlan(job(), {})).toEqual({ urls: [AWS], names: ["AirBattleground"], tee: false });
    expect(publishPlan(job(), { publishBase: "rtmp://127.0.0.1:1937/live" }).urls).toEqual(["rtmp://127.0.0.1:1937/live/show_abc12345?wtoken=1.sig"]);
  });

  it("sendToAws on: outputs + AWS at once", () => {
    const p = publishPlan(job({ outputs: [YT, KEY], sendToAws: true }), {});
    expect(p).toEqual({ urls: [YT.url, KEY.url, AWS], names: ["YouTube", "Facebook", "AirBattleground"], tee: true });
  });

  it("sendToAws off: outputs only (+ the box preview copy when BOX_RTMP_BASE is set)", () => {
    expect(publishPlan(job({ outputs: [YT], sendToAws: false }), {}).urls).toEqual([YT.url]);
    expect(publishPlan(job({ outputs: [YT], sendToAws: false }), { boxPublishBase: "rtmp://127.0.0.1:1935/live" }).urls).toEqual([
      YT.url,
      "rtmp://127.0.0.1:1935/live/show_abc12345?wtoken=1.sig",
    ]);
  });

  it("nothing to send: local copy via BOX_RTMP_BASE, else PUBLISH_RTMP_BASE, else encode only", () => {
    const j = job({ outputs: [], sendToAws: false });
    expect(publishPlan(j, { boxPublishBase: "rtmp://127.0.0.1:1935/live", publishBase: "rtmp://x/live" }).urls).toEqual(["rtmp://127.0.0.1:1935/live/show_abc12345?wtoken=1.sig"]);
    expect(publishPlan(j, { publishBase: "rtmp://127.0.0.1:1935/live" }).urls).toEqual(["rtmp://127.0.0.1:1935/live/show_abc12345?wtoken=1.sig"]);
    expect(publishPlan(j, {})).toEqual({ urls: [], names: [], tee: true });
  });

  it("logs never carry stream keys", () => {
    expect(redactKeys(`Slave '[f=flv]${YT.url}': error opening`)).toBe("Slave '[f=flv]rtmp://a.rtmp.youtube.com/live2/…': error opening");
  });
});

describe("box info in the poll", () => {
  it("adds `box` when the box answers, leaves it out when it doesn't", async () => {
    const bodies: WorkerPollInput[] = [];
    let box: { lanUrl: string; devices: number; streaming: number } | null = { lanUrl: "http://192.168.1.20:4300", devices: 3, streaming: 1 };
    const runner = new JobRunner(async () => ({ kbps: () => null, stop: async () => {} }));
    const step = makePollStep({
      poll: async (b) => {
        bodies.push(b);
        return { kind: "ok", res: { worker: { id: "w", name: "Box" }, job: null } };
      },
      runner,
      version: "1",
      encoder: "libx264",
      boxInfo: async () => box,
    });
    await step();
    box = null;
    await step();
    expect(bodies[0]!.box).toEqual({ lanUrl: "http://192.168.1.20:4300", devices: 3, streaming: 1 });
    expect(bodies[1]).not.toHaveProperty("box");
  });
});

import { recordingPath } from "../src/pipeline.js";
import { isRecordingPath, teeTarget as teeOf } from "../src/encoder.js";
describe("record on this box", () => {
  const base = { showId: "show123", title: "Evening Scrim!", renderUrl: "http://b/r", session: { cookieName: "c", token: "t" }, publishUrl: "rtmp://aws:1935/live/show_show123?wtoken=1.s", videoKbps: 6000, fps: 60 };
  it("records to a dated mp4 and sends nowhere else", () => {
    const plan = publishPlan({ ...base, outputs: [], sendToAws: false, record: true }, { recordDir: "/rec" });
    expect(plan.urls).toHaveLength(1);
    expect(plan.urls[0]).toMatch(/^\/rec\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_evening-scrim_show123\.mp4$/);
    expect(plan.names).toEqual(["Recording on this box"]);
  });
  it("keeps the box preview next to the recording", () => {
    const plan = publishPlan({ ...base, outputs: [], sendToAws: false, record: true }, { recordDir: "/rec", boxPublishBase: "rtmp://127.0.0.1:1939/live" });
    expect(plan.urls[1]).toBe("rtmp://127.0.0.1:1939/live/show_show123?wtoken=1.s");
  });
  it("writes fragmented mp4 for the file, flv for rtmp", () => {
    const t = teeOf(["/rec/a.mp4", "rtmp://x/live/k"]);
    expect(t).toContain("[f=mp4:movflags=+frag_keyframe+empty_moov+default_base_moof:onfail=ignore]/rec/a.mp4");
    expect(t).toContain("[f=flv:onfail=ignore:flvflags=no_duration_filesize]rtmp://x/live/k");
    expect(isRecordingPath("rtmp://x/a.mp4")).toBe(false);
  });
  it("names a file per (re)start", () => {
    expect(recordingPath({ ...base, title: "" } as never, "/r", new Date(2026, 9, 21, 9, 5, 7))).toBe("/r/2026-10-21_09-05-07_show_show123.mp4");
  });
});
