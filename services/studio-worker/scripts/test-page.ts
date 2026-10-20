import { RENDER_VIDEO_BPS, STUDIO_FPS } from "@7xen/shared";

/** What the real /studio-render page must do, in miniature. */
export function testPage(mime = "video/webm;codecs=vp8,opus"): string {
  return `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="1280" height="720"></canvas>
<script>
const c = document.getElementById("c"), g = c.getContext("2d");
let frames = 0, fps = 0, t0 = performance.now();
function draw(now) {
  const t = now / 1000;
  g.fillStyle = "hsl(" + ((t * 40) % 360) + ",60%,20%)"; g.fillRect(0, 0, 1280, 720);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = "hsl(" + (i * 9) + ",80%,60%)";
    g.fillRect(640 + Math.cos(t * 2 + i) * 500 - 20, 360 + Math.sin(t * 3 + i) * 300 - 20, 40, 40);
  }
  g.fillStyle = "#fff"; g.font = "bold 64px sans-serif"; g.fillText("7XEN worker smoke " + t.toFixed(2), 60, 100);
  frames++;
  if (now - t0 >= 1000) { fps = frames * 1000 / (now - t0); frames = 0; t0 = now; }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// audio: always send an audio track (silent is fine) — ffmpeg maps it when present
const ac = new AudioContext({ sampleRate: 48000 });
const osc = ac.createOscillator(); osc.frequency.value = 440;
const gain = ac.createGain(); gain.gain.value = 0.2;
const dest = ac.createMediaStreamDestination();
osc.connect(gain).connect(dest); osc.start();

const stream = new MediaStream([...c.captureStream(${STUDIO_FPS}).getVideoTracks(), ...dest.stream.getAudioTracks()]);
const rec = new MediaRecorder(stream, { mimeType: "${mime}", videoBitsPerSecond: ${RENDER_VIDEO_BPS}, audioBitsPerSecond: 128000 });
let chain = Promise.resolve(), recording = false, err = null;
function b64(buf) { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
rec.ondataavailable = (e) => {
  if (!e.data.size) return;
  chain = chain.then(async () => { await window.__swChunk(b64(await e.data.arrayBuffer())); recording = true; }).catch((x) => { err = String(x); });
};
rec.onerror = (e) => { err = String(e.error || e); };
rec.start(500);
setInterval(() => window.__swStatus({ fps: Math.round(fps), recording, error: err }), 1000);
</script></body></html>`;
}
