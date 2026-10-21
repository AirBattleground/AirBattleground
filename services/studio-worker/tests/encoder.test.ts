import { describe, expect, it } from "vitest";
import { candidates, detectEncoder, ffmpegArgs, parseEncoders, ProgressMeter, videoArgs, type ProbeRunner } from "../src/encoder.js";

const O = { fps: 60, kbps: 6000, cores: 8 };
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("videoArgs", () => {
  it.each(["h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox", "libx264"])("%s: CBR, 2 s keyframes, 720p cfr", (enc) => {
    const a = videoArgs(enc, O);
    expect(after(a, "-c:v")).toBe(enc);
    expect(after(a, "-b:v")).toBe("6000k");
    expect(after(a, "-maxrate")).toBe("6000k");
    expect(after(a, "-bufsize")).toBe("12000k");
    expect(after(a, "-g")).toBe("120");
    expect(after(a, "-force_key_frames")).toBe("expr:gte(t,n_forced*2)");
    expect(after(a, "-s")).toBe("1280x720");
    expect(after(a, "-r")).toBe("60");
    expect(after(a, "-fps_mode")).toBe("cfr");
    expect(after(a, "-pix_fmt")).toBe(enc === "libx264" ? "yuv420p" : "nv12");
  });

  it("encoder-specific low-latency flags", () => {
    const nv = videoArgs("h264_nvenc", O);
    expect(after(nv, "-rc")).toBe("cbr");
    expect(after(nv, "-bf")).toBe("0");
    expect(after(videoArgs("h264_videotoolbox", O), "-realtime")).toBe("1");
    expect(after(videoArgs("h264_amf", O), "-usage")).toBe("lowlatency");
    const x = videoArgs("libx264", O);
    expect(after(x, "-tune")).toBe("zerolatency");
    expect(after(x, "-preset")).toBe("veryfast");
    expect(after(videoArgs("libx264", { ...O, cores: 32 }), "-preset")).toBe("faster");
  });

  it("follows fps and bitrate", () => {
    const a = videoArgs("libx264", { fps: 30, kbps: 4000, cores: 4 });
    expect(after(a, "-g")).toBe("60");
    expect(after(a, "-bufsize")).toBe("8000k");
  });
});

describe("ffmpegArgs", () => {
  it("webm stdin → aac + flv output, optional audio", () => {
    const a = ffmpegArgs("libx264", { ...O, output: "rtmp://h/live/show_1?wtoken=x" });
    expect(after(a, "-f")).toBe("webm");
    expect(after(a, "-i")).toBe("pipe:0");
    expect(a).toContain("0:a:0?");
    expect(after(a, "-c:a")).toBe("aac");
    expect(after(a, "-ar")).toBe("48000");
    expect(after(a, "-progress")).toBe("pipe:1");
    expect(a.slice(-3)).toEqual(["-f", "flv", "rtmp://h/live/show_1?wtoken=x"]);
  });
});

describe("detectEncoder", () => {
  const encodersOut = " V..... = Video\n ------\n V....D libx264              libx264 H.264\n V....D h264_qsv             QSV\n A....D aac                  AAC\n";
  const runner = (works: string[]): ProbeRunner => async (_p, args) => {
    if (args.includes("-encoders")) return { ok: true, stdout: encodersOut, stderr: "" };
    const enc = args[args.indexOf("-c:v") + 1]!;
    return works.includes(enc) ? { ok: true, stdout: "", stderr: "" } : { ok: false, stdout: "", stderr: "Device creation failed\n" };
  };

  it("parses the encoder list", () => {
    expect([...parseEncoders(encodersOut)]).toEqual(["libx264", "h264_qsv", "aac"]);
  });

  it("picks the first working one, skipping ones not built in", async () => {
    const d = await detectEncoder("ffmpeg", { fps: 60, kbps: 6000, platform: "linux", cores: 8, run: runner(["h264_qsv", "libx264"]) });
    expect(d.encoder).toBe("h264_qsv");
    expect(d.skipped.h264_nvenc).toBe("not in this ffmpeg build");
  });

  it("falls back to libx264 when the GPU fails", async () => {
    const d = await detectEncoder("ffmpeg", { fps: 60, kbps: 6000, platform: "linux", cores: 8, run: runner(["libx264"]) });
    expect(d.encoder).toBe("libx264");
    expect(d.skipped.h264_qsv).toBe("Device creation failed");
  });

  it("honours an override", async () => {
    const d = await detectEncoder("ffmpeg", { override: "h264_nvenc", fps: 60, kbps: 6000, cores: 8, run: runner([]) });
    expect(d.encoder).toBe("h264_nvenc");
  });

  it("platform order", () => {
    expect(candidates("darwin")[0]).toBe("h264_videotoolbox");
    expect(candidates("win32")).toContain("h264_amf");
    expect(candidates("linux").at(-1)).toBe("libx264");
  });
});

describe("ProgressMeter", () => {
  it("kbps from total_size over wall time", () => {
    let t = 0;
    const m = new ProgressMeter(() => t);
    m.feed("frame=10\ntotal_size=1000\nout_time_us=2000000\nbitrate=4000.0kbits/s\nprogress=continue\n");
    expect(m.kbps).toBe(4000); // first block: ffmpeg's own average
    t = 2000;
    m.feed("total_size=1501");
    expect(m.feed("000\nout_time_us=4000000\nprogress=continue\n")).toBe(true);
    expect(m.kbps).toBe(6000); // 1.5 MB in 2 s
    expect(m.outSeconds).toBe(4);
  });
});

import { publishTarget } from "../src/pipeline.js";
describe("publishTarget", () => {
  it("keeps the job URL without a base", () => {
    expect(publishTarget("rtmp://a.com:1935/live/show_x?wtoken=1.s", null)).toBe("rtmp://a.com:1935/live/show_x?wtoken=1.s");
  });
  it("swaps host and base path, keeps path + token", () => {
    expect(publishTarget("rtmp://a.com:1935/live/show_x?wtoken=1.s", "rtmp://127.0.0.1:1937/live")).toBe("rtmp://127.0.0.1:1937/live/show_x?wtoken=1.s");
  });
});
