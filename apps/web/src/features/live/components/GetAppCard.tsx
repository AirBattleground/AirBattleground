import { Link } from "react-router-dom";
import { ArrowRight, Smartphone } from "lucide-react";
import type { AppRelease } from "@7xen/shared";
import { APP_DOWNLOAD_URL, useAppRelease } from "../api";
import { fmtBytes } from "../format";

export const releaseDownloadUrl = (r: AppRelease) => r.url || APP_DOWNLOAD_URL;

/** Manager dashboard: "Get the 7XEN Manager app". Renders nothing until a release exists. */
export function GetAppCard() {
  const q = useAppRelease();
  const r = q.data;
  if (!r) return null;
  return (
    <Link
      to="/manager/app"
      data-tour="get-app"
      className="group relative flex items-center gap-4 overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all outline-none hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-glow focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-5"
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-primary/10 to-transparent opacity-60 transition-opacity group-hover:opacity-100" />
      <div className="relative flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow [&_svg]:size-6">
        <Smartphone />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="font-display text-xl leading-tight font-bold">Get the 7XEN Manager app</div>
        <div className="text-sm text-muted-foreground">Record matches, create rooms and capture screenshots automatically. Android · v{r.version} · {fmtBytes(r.sizeBytes)}</div>
      </div>
      <ArrowRight className="relative size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
    </Link>
  );
}
