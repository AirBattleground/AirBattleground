import { Link } from "react-router-dom";
import { ArrowRight, Smartphone } from "lucide-react";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { useAdminRecordings, useAppSettings, useLatestRelease } from "./api";
import { fmtBytes } from "./components";

/** Overview card: latest Manager app version, recordings storage, live recordings. Links to the section (also the phone entry point). */
export function ManagerAppCard() {
  const release = useLatestRelease();
  const settings = useAppSettings({ refetchInterval: 60_000 });
  const live = useAdminRecordings({ status: "LIVE" });
  const liveCount = live.data?.items.length ?? 0;
  const storage = settings.data?.videoStorage;
  const loading = release.isPending || settings.isPending;
  return (
    <Link
      to="/manager-app/recordings"
      data-tour="manager-app-card"
      className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary [&_svg]:size-6">
        <Smartphone />
        {liveCount > 0 && <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full border-2 border-card bg-destructive" aria-hidden />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl font-bold">Manager app</div>
        <div className="text-sm text-muted-foreground">
          {loading ? (
            <Skeleton className="mt-1 h-4 w-48" />
          ) : (
            <>
              {release.data ? `Latest v${release.data.version}` : "No release published"}
              {storage && ` · ${storage.videos} video${storage.videos === 1 ? "" : "s"}, ${fmtBytes(storage.usedBytes)}`}
              {liveCount > 0 && <span className="font-semibold text-destructive"> · {liveCount} recording now</span>}
            </>
          )}
        </div>
      </div>
      <span className="hidden text-sm text-muted-foreground sm:block">Recordings, recipes, settings</span>
      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
    </Link>
  );
}
