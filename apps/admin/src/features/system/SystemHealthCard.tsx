import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, Clock, Cpu, HardDrive, MemoryStick, Network, Radio, Server, Smartphone } from "lucide-react";
import type { SystemHealth } from "@7xen/shared";
import { Pill } from "@7xen/ui/components/brand/status";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/forms";
import { Gauge } from "./Gauge";

/** Polls every 3 s while the tab is visible (React Query pauses interval refetches in background tabs). */
function useSystemHealth() {
  return useQuery({
    queryKey: ["admin", "system", "health"],
    queryFn: () => api.get<SystemHealth>("/api/admin/system/health"),
    refetchInterval: 3_000,
  });
}

const GB = 1024 ** 3;
const gb = (b: number) => (b / GB >= 100 ? (b / GB).toFixed(0) : (b / GB).toFixed(1));

function mbps(bps: number) {
  const m = bps / 1e6;
  return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m.toFixed(2);
}

/** Smallest "nice" full-scale (Mbps) that fits the reading, so the needle stays readable at low traffic. */
function netScale(bps: number) {
  const m = bps / 1e6;
  return [10, 50, 100, 250, 500, 1000, 5000, 10000].find((s) => m <= s * 0.9) ?? 10000;
}

function uptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function Fact({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-background/60 px-3 py-2">
      <span className="text-primary [&_svg]:size-4">{icon}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</div>
        <div className="truncate font-display text-base leading-tight font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export function SystemHealthCard() {
  const q = useSystemHealth();
  const h = q.data;

  return (
    <section data-tour="system-card" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Server className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl leading-tight font-bold">Server health</h2>
          <p className="text-sm text-muted-foreground">The whole machine, live. Updates every 3 seconds.</p>
        </div>
        {h && (
          <Pill tone={h.cpuPct >= 85 || h.memUsedBytes / h.memTotalBytes >= 0.9 ? "danger" : h.cpuPct >= 60 ? "warning" : "success"} icon={<Activity className="size-3.5" />}>
            {h.cpuPct >= 85 || h.memUsedBytes / h.memTotalBytes >= 0.9 ? "Under heavy load" : h.cpuPct >= 60 ? "Busy" : "Healthy"}
          </Pill>
        )}
      </div>

      {q.isError && !h ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">Couldn't read server health. {errorMessage(q.error)}</div>
      ) : !h ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[230px] rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Gauge label="CPU" icon={<Cpu />} pct={h.cpuPct} value={Math.round(h.cpuPct)} unit="%" sub={`${h.cores} cores · load ${h.load1.toFixed(2)}`} />
            <Gauge
              label="RAM"
              icon={<MemoryStick />}
              pct={(h.memUsedBytes / h.memTotalBytes) * 100}
              value={Math.round((h.memUsedBytes / h.memTotalBytes) * 100)}
              unit="%"
              sub={`${gb(h.memUsedBytes)} of ${gb(h.memTotalBytes)} GB`}
              dangerAt={90}
            />
            <Gauge
              label="Disk"
              icon={<HardDrive />}
              pct={(h.diskUsedBytes / h.diskTotalBytes) * 100}
              value={Math.round((h.diskUsedBytes / h.diskTotalBytes) * 100)}
              unit="%"
              sub={`${gb(h.diskTotalBytes - h.diskUsedBytes)} GB free of ${gb(h.diskTotalBytes)} GB`}
              warnAt={75}
              dangerAt={90}
            />
            {(() => {
              const total = h.netInBps + h.netOutBps;
              const scale = netScale(Math.max(h.netInBps, h.netOutBps));
              return (
                <Gauge
                  label="Network"
                  icon={<Network />}
                  neutral
                  pct={(Math.max(h.netInBps, h.netOutBps) / 1e6 / scale) * 100}
                  value={mbps(total)}
                  unit="Mbps"
                  sub={
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex items-center gap-0.5 text-success">
                        <ArrowDown className="size-3" /> {mbps(h.netInBps)}
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-info">
                        <ArrowUp className="size-3" /> {mbps(h.netOutBps)}
                      </span>
                    </span>
                  }
                />
              );
            })()}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Fact icon={<Clock />} label="Up for" value={uptime(h.uptimeSec)} />
            <Fact icon={<Activity />} label="Load 1 / 5 / 15" value={`${h.load1.toFixed(1)} / ${h.load5.toFixed(1)} / ${h.load15.toFixed(1)}`} />
            <Fact icon={<Radio />} label="Live streams" value={h.liveStreams} />
            <Fact icon={<ArrowDown />} label="Video coming in" value={`${mbps(h.ingestBps)} Mbps`} />
            <Fact icon={<Smartphone />} label="Phones online" value={`${h.devicesOnline} / ${h.devicesTotal}`} />
          </div>
          {!h.mediaOnline && (
            <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              The video server isn't answering, so phones can't stream right now. Restart the <code className="font-mono">media</code> container on the server.
            </p>
          )}
        </>
      )}
    </section>
  );
}
