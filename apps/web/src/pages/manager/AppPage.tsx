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
  { title: "The 7XEN Manager app", description: "Your match-day companion on Android: it records the game, helps create the room and captures the team list and results for you." },
  { element: '[data-tour="app-download"]', title: "Download", description: "Open this page on your Android phone and tap Download. It's a direct install file (APK), not from the Play Store.", side: "bottom" },
  { element: '[data-tour="app-install"]', title: "Install in a minute", description: "Follow these steps the first time. Android asks once to allow installs from your browser.", side: "top" },
  { element: '[data-tour="app-permissions"]', title: "Permissions", description: "What the app asks for and why. Accessibility is only needed if you turn on Auto mode.", side: "top" },
  { element: '[data-tour="app-warning"]', title: "Read this before Auto mode", description: "Automatic taps can be flagged by BGMI. Use a spare host account if you switch it on.", side: "top" },
];

const INSTALL = [
  { icon: FileDown, title: "Download the app on your phone", text: "Open this page in Chrome on your Android phone and tap Download. If Chrome says the file might be harmful, tap Download anyway — it's from 7xen." },
  { icon: ShieldCheck, title: "Allow installs from this source", text: "When you open the file, Android asks for permission. Tap Settings, turn on “Allow from this source” for Chrome, then go back." },
  { icon: Smartphone, title: "Open the file and tap Install", text: "Find it in Downloads (or the notification) and tap Install. If Play Protect warns you, tap More details → Install anyway — the app isn't on the Play Store." },
  { icon: LogIn, title: "Sign in", text: "Use the same username and password as this portal. Your scrim and tournament matches for today show up right away." },
];

const PERMISSIONS = [
  { icon: Layers, title: "Display over other apps", text: "Shows the small 7XEN bubble and the room checklist on top of BGMI." },
  { icon: Bell, title: "Notifications", text: "Keeps recording running with Stop / Pause controls, and shows upload progress." },
  { icon: MonitorPlay, title: "Screen capture", text: "Records the match and spots the team list and results screens. Android asks every time you go live." },
  { icon: Accessibility, title: "Accessibility — Auto mode only", text: "Lets the app tap the room-creation steps for you. Not needed for the default Assisted mode, where you tap and the app guides you." },
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
        <PageHeader eyebrow="Android app" title="7XEN Manager" />
        <EmptyState icon={<Smartphone />} title="The app isn't available yet" description="The admin hasn't published the Manager app yet. Check back soon — you can keep running matches from this portal meanwhile." />
      </>
    );

  return (
    <>
      {back}
      <PageHeader eyebrow="Android app" title={<>7XEN <span className="text-gradient-brand">Manager</span></>} description="Run match day from your phone: record every game, create the room, and capture the team list and results automatically." />

      <div className="space-y-6">
        <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-5 shadow-glow sm:p-7">
          <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
          <div className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full bg-primary/20 blur-3xl animate-aurora" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow animate-float">
              <Smartphone className="size-8" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-2xl font-bold sm:text-3xl">Version {r.version}</h2>
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
          <section data-tour="app-install" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 font-display text-2xl font-bold">Install in 4 steps</h2>
            <ol className="space-y-4">
              {INSTALL.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-gradient-to-b from-primary/25 to-primary/5 text-primary">
                    <s.icon className="size-5" />
                    <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{i + 1}</span>
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-lg leading-snug font-bold">{s.title}</div>
                    <p className="text-sm text-muted-foreground">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section data-tour="app-permissions" className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="mb-1 font-display text-2xl font-bold">Permissions it asks for</h2>
            <p className="mb-4 text-sm text-muted-foreground">The app explains each one when it asks. Here's why it needs them.</p>
            <ul className="space-y-3">
              {PERMISSIONS.map((p) => (
                <li key={p.title} className="flex gap-3 rounded-xl border bg-background/60 p-3">
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

        <section data-tour="app-warning" className="flex gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4 sm:p-5">
          <ShieldAlert className="mt-0.5 size-6 shrink-0 text-warning-foreground dark:text-warning" />
          <div className="space-y-1">
            <h2 className="font-display text-xl font-bold">Auto mode and BGMI — read this first</h2>
            <p className="text-sm">
              In <strong>Auto mode</strong> the app taps through room creation for you. BGMI's anti-cheat may treat automatic taps as a third-party tool and could flag or ban the
              account. Auto mode is off by default — <strong>Assisted mode</strong> (you tap, the app shows the next step) is safe to use. If you switch Auto mode on, use a
              spare host account, never your main one.
            </p>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="flex gap-3 rounded-xl border bg-card p-4">
            <BatteryCharging className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm">
              <span className="font-semibold">Turn off battery optimisation</span> for 7XEN Manager (Settings → Apps → 7XEN Manager → Battery → Unrestricted) so recording isn't
              stopped mid-match.
            </p>
          </div>
          <div className="flex gap-3 rounded-xl border bg-card p-4">
            <Wifi className="mt-0.5 size-5 shrink-0 text-primary" />
            <p className="text-sm">
              <span className="font-semibold">Videos upload on Wi-Fi</span> by default and resume if the connection drops. Watch them later in each match center.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
