import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, ListChecks, Smartphone, Video } from "lucide-react";
import { toast } from "sonner";
import { ApiError, updateSettingsSchema } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAppSettings, useLatestRelease, useUpdateSettings } from "@/features/managerApp/api";
import { fmtBytes, ManagerAppHeader, StorageBar } from "@/features/managerApp/components";
import { errorMessage } from "@/lib/forms";
import { shortDate } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Manager app settings", description: "How long match videos are kept, and how much space they use." },
  { element: '[data-tour="retention"]', title: "Keep videos for…", description: "Videos older than this are deleted automatically to free up disk space. Results and screenshots are never deleted.", side: "bottom" },
  { element: '[data-tour="storage"]', title: "Storage", description: "Space used by match videos on the server's disk.", side: "top" },
  { element: '[data-tour="tab-recipes"]', title: "Recipes", description: "The touch steps the app follows to create a room. Edit them when BGMI changes its screens.", side: "bottom" },
];

const PRESETS = [7, 14, 30, 90];

function RetentionForm({ initial }: { initial: number }) {
  const update = useUpdateSettings();
  const [value, setValue] = useState(String(initial));
  const [error, setError] = useState<string | null>(null);
  const dirty = Number(value) !== initial;

  const save = () => {
    const parsed = updateSettingsSchema.safeParse({ videoRetentionDays: Number(value) });
    if (!value.trim() || !parsed.success) {
      setError("Enter a number of days between 1 and 3650.");
      return;
    }
    setError(null);
    update.mutate(parsed.data, {
      onSuccess: (s) => toast.success("Saved", { description: `Videos are kept for ${s.videoRetentionDays} days.` }),
      onError: (err) => {
        if (err instanceof ApiError && err.fields?.videoRetentionDays) setError(err.fields.videoRetentionDays);
        else toast.error("Couldn't save", { description: errorMessage(err) });
      },
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3"
      noValidate
    >
      <Label htmlFor="retention" className="text-sm">
        Delete match videos after
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Input
            id="retention"
            type="number"
            inputMode="numeric"
            min={1}
            max={3650}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error || undefined}
            className="h-11 w-32 pr-12 font-display text-lg font-bold"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">days</span>
        </div>
        {PRESETS.map((d) => (
          <Button key={d} type="button" variant={Number(value) === d ? "secondary" : "outline"} size="sm" onClick={() => setValue(String(d))}>
            {d} days
          </Button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Not saved yet</span>}
      </div>
    </form>
  );
}

export default function SettingsPage() {
  usePageTour("admin.managerAppSettings", TOUR);
  const settings = useAppSettings();
  const release = useLatestRelease();
  const s = settings.data;

  return (
    <>
      <ManagerAppHeader title="Settings" description="Video retention and storage for the 7XEN Manager app." />
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 shadow-sm" data-tour="retention">
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Keep videos for</h2>
          </div>
          {settings.isPending ? (
            <Skeleton className="h-28 rounded-lg" />
          ) : s ? (
            <RetentionForm key={s.videoRetentionDays} initial={s.videoRetentionDays} />
          ) : (
            <p className="text-sm text-muted-foreground">{settings.isError ? `Couldn't load settings. ${errorMessage(settings.error)}` : "Settings aren't available on this server yet."}</p>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Results, screenshots and points are never deleted — only the video files.</p>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Video className="size-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Video storage</h2>
          </div>
          {settings.isPending ? <Skeleton className="h-20 rounded-lg" /> : s ? <StorageBar storage={s.videoStorage} /> : <p className="text-sm text-muted-foreground">No storage details yet.</p>}
          <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
            <Link to="/manager-app/recordings">
              See all recordings <ArrowRight />
            </Link>
          </Button>
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <Smartphone className="size-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Latest app release</h2>
          </div>
          {release.isPending ? (
            <Skeleton className="h-10 rounded-lg" />
          ) : release.data ? (
            <p className="text-sm">
              <span className="font-display text-2xl font-bold">v{release.data.version}</span>
              <span className="ml-2 text-muted-foreground">
                {fmtBytes(release.data.sizeBytes)} · {shortDate(release.data.publishedAt)} · build {release.data.versionCode}
              </span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No release published. Managers don't see a download until one is.</p>
          )}
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <ListChecks className="size-5 text-primary" />
            <h2 className="font-display text-xl font-bold">Room recipes</h2>
          </div>
          <p className="text-sm text-muted-foreground">The step-by-step touch guides the app uses to create a room, open the team list and scroll results.</p>
          <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
            <Link to="/manager-app/recipes">
              Edit recipes <ArrowRight />
            </Link>
          </Button>
        </section>
      </div>
    </>
  );
}
