/**
 * Phase 6: server health for the admin dashboard (speedometer gauges).
 *
 * ADMIN (role ADMIN)
 *   GET /api/admin/system/health → SystemHealth   (sampled every 2 s in the API; cheap to poll every 3 s)
 *
 * Figures are for the whole machine, not the API container (the API reads the host's /proc).
 */
export interface SystemHealth {
  /** whole-machine CPU use over the last sample, 0–100 */
  cpuPct: number;
  cores: number;
  load1: number;
  load5: number;
  load15: number;
  memUsedBytes: number;
  memTotalBytes: number;
  /** disk holding uploads / videos */
  diskUsedBytes: number;
  diskTotalBytes: number;
  /** network throughput of the machine's real interfaces (not docker bridges), bits per second */
  netInBps: number;
  netOutBps: number;
  uptimeSec: number;
  /** streaming (phase 6): phones the video server is receiving right now, and their combined bitrate */
  liveStreams: number;
  ingestBps: number;
  devicesOnline: number;
  devicesTotal: number;
  /** false when the video server (MediaMTX) can't be reached */
  mediaOnline: boolean;
  at: string;
}
