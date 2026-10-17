import { MonitorPlay } from "lucide-react";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { useStationStatus } from "./api";
import { StationPill, stationFacts } from "./StationCard";

const HOW = [
  { title: "Runs on the server PC", text: "The Station is an Android game phone (emulator) that runs on the host PC as a background service — not in Docker, because it needs the PC's graphics and virtualisation." },
  { title: "Managers press Prepare", text: "On a match page, Prepare starts the emulator, opens BGMI and starts recording. The match streams live to the manager and the teams in it." },
  { title: "Stop saves the video", text: "When the manager stops it, the full video lands in Recordings like phone uploads, and follows the same retention." },
];

/** Settings section: Station status + a short how-it-works. */
export function StationHowTo({ className }: { className?: string }) {
  const q = useStationStatus();
  const s = q.data;
  return (
    <section data-tour="station-settings" className={cn("rounded-xl border bg-card p-5 shadow-sm", className)}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MonitorPlay className="size-5 text-primary" />
        <h2 className="font-display text-xl font-bold">7XEN Station</h2>
        {s ? <StationPill s={s} /> : <Skeleton className="h-5 w-16 rounded-full" />}
      </div>
      <p className="text-sm text-muted-foreground">{q.isPending ? <Skeleton className="h-4 w-64" /> : q.isError ? "Couldn't check the station." : s && stationFacts(s)}</p>
      {s?.online && s.error && <p className="mt-1 text-xs text-destructive">{s.error}</p>}
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {HOW.map((h, i) => (
          <li key={h.title} className="flex gap-3 rounded-lg border bg-background/60 p-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{i + 1}</span>
            <span>
              <span className="block text-sm font-semibold">{h.title}</span>
              <span className="block text-xs text-muted-foreground">{h.text}</span>
            </span>
          </li>
        ))}
      </ol>
      {s && !s.online && (
        <p className="mt-3 text-xs text-muted-foreground">
          Offline? Start the station service on the host PC (it listens on port 4500 and the API reaches it via <code className="rounded bg-muted px-1">STATION_URL</code>).
        </p>
      )}
    </section>
  );
}
