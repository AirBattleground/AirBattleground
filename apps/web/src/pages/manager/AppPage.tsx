import { Link } from "react-router-dom";
import { ArrowLeft, Accessibility, BatteryCharging, Bell, Download, FileDown, Layers, LogIn, MonitorPlay, ShieldAlert, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { QueryError } from "@/features/manager/components/QueryError";
import { useAppRelease } from "@/features/live/api";
import { releaseDownloadUrl } from "@/features/live/components/GetAppCard";
import { fmtBytes } from "@/features/live/format";
import { fmtDay } from "@/features/tournaments/shared/format";

const TOUR: TourStep[] = [
  { title: "The AirBattleground Manager app", description: "Your match-day companion on Android: it records the game, helps create the room and captures the team list and results for you." },
  { element: '[data-tour="app-download"]', title: "Download", description: "Open this page on your Android phone and tap Download. It's a direct install file (APK), not from the Play Store.", side: "bottom" },
  { element: '[data-tour="app-install"]', title: "Install in a minute", description: "Follow these steps the first time. Android asks once to allow installs from your browser.", side: "top" },
  { element: '[data-tour="app-permissions"]', title: "Permissions", description: "What the app asks for and why. Accessibility is only needed if you turn on Auto mode.", side: "top" },
  { element: '[data-tour="app-warning"]', title: "Read this before Auto mode", description: "Automatic taps can be flagged by BGMI. Use a spare host account if you switch it on.", side: "top" },
];

const INSTALL = [
  { icon: FileDown, title: "Download on your phone", text: "Open this page in Chrome on Android and tap Download. If Chrome warns you, tap Download anyway." },
  { icon: ShieldCheck, title: "Allow installs from Chrome", text: "Android asks once: tap Settings → turn on “Allow from this source” → go back." },
  { icon: Smartphone, title: "Tap Install", text: "If Play Protect warns you, tap More details → Install anyway (it isn't on the Play Store)." },
  { icon: LogIn, title: "Sign in", text: "Same username and password as this portal. Today's matches show up right away." },
];

const PERMISSIONS = [
  { icon: Layers, title: "Display over other apps", text: "Shows the bubble and room checklist on top of BGMI." },
  { icon: Bell, title: "Notifications", text: "Recording controls and upload progress." },
  { icon: MonitorPlay, title: "Screen capture", text: "Records the match and spots the team list and results screens." },
  { icon: Accessibility, title: "Accessibility (Auto mode only)", text: "Taps the room-creation steps for you. Not needed in Assisted mode." },
];

export default function AppPage() {
  usePageTour("manager.app", TOUR);
  const q = useAppRelease();
  const r = q.data;

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/manager">
        <ArrowLeft /> Dashboard
      </Link>
    </Button>
  );

  if (q.isError)
    return (
      <>
        {back}
        <QueryError error={q.error} onRetry={() => void q.refetch()} title="Couldn't load the app details" />
      </>
    );

  if (q.isPending)
    return (
      <>
        {back}
        <Skeleton className="mb-6 h-12 w-72" />
        <Skeleton className="h-48 rounded-2xl" />
      </>
    );

  if (!r)
    return (
      <>
        {back}
        <PageHeader eyebrow="Android app" title="AirBattleground Manager" />
        <EmptyState icon={<Smartphone />} title="The app isn't available yet" description="The admin hasn't published the Manager app yet. Check back soon — you can keep running matches from this portal meanwhile." />
      </>
    );

  return (
    <>
      {back}
      <PageHeader eyebrow="Android app" title={<>AirBattleground <span className="text-gradient-brand">Manager</span></>} description="Record games, create the room and capture screenshots from your phone." />

      <div className="space-y-6">
        <section className="rounded-xl border border-primary/30 bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Smartphone className="size-6" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-bold">Version {r.version}</h2>
                <Pill tone="brand">Android</Pill>
              </div>
              <p className="text-sm text-muted-foreground">
                {fmtBytes(r.sizeBytes)} · released {fmtDay(r.publishedAt)} · Android 10 or newer
              </p>
              {r.notes && <p className="max-w-2xl text-sm whitespace-pre-line">{r.notes}</p>}
            </div>
            <Button asChild size="lg" className="h-12 px-6 text-base shadow-glow" data-tour="app-download">
              <a href={releaseDownloadUrl(r)} download>
                <Download /> Download APK
              </a>
            </Button>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section data-tour="app-install" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Install in 4 steps</h2>
            <ol className="space-y-4">
              {INSTALL.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <s.icon className="size-4 text-primary" /> {s.title}
                    </div>
                    <p className="text-sm text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section data-tour="app-permissions" className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Permissions it asks for</h2>
            <ul className="divide-y">
              {PERMISSIONS.map((p) => (
                <li key={p.title} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <p.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="font-semibold">{p.title}</div>
                    <p className="text-sm text-muted-foreground">{p.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section data-tour="app-warning" className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 sm:p-5">
          <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warning-foreground dark:text-warning" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold">Auto mode can get an account flagged</h2>
            <p className="text-sm">
              BGMI may treat automatic taps as a third-party tool. <strong>Assisted mode</strong> (the default) is safe. If you turn Auto mode on, use a spare host account —
              never your main one.
            </p>
          </div>
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tips</h2>
          <ul className="space-y-2.5 text-sm">
            <li className="flex gap-3">
              <BatteryCharging className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold">Set battery to Unrestricted</span> (Settings → Apps → AirBattleground Manager → Battery) so recording isn't stopped.
              </span>
            </li>
            <li className="flex gap-3">
              <Wifi className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <span className="font-semibold">Videos upload on Wi-Fi</span> and resume if the connection drops.
              </span>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
