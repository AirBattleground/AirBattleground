import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Loader2, Radio, Save, Unplug, Youtube } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_YOUTUBE_TITLE,
  YOUTUBE_PRIVACY,
  YOUTUBE_PRIVACY_LABELS,
  YOUTUBE_TITLE_TOKENS,
  youtubeTitle,
  type YoutubePrivacy,
  type YoutubeStatus,
} from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Badge } from "@7xen/ui/components/ui/badge";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Switch } from "@7xen/ui/components/ui/switch";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useConnectYoutube, useDisconnectYoutube, useUpdateYoutube, useYoutube } from "@/features/youtube/api";
import { errorMessage } from "@/lib/forms";

const TOUR: TourStep[] = [
  { title: "YouTube channel", description: "Connect the AirBattleground YouTube channel once. Every match a manager streams then goes live there too, with its own title." },
  { element: '[data-tour="yt-connect"]', title: "Connect", description: "Sign in with the Google account that owns the channel and allow access.", side: "bottom" },
  { element: '[data-tour="yt-settings"]', title: "Settings", description: "Turn streaming every match on or off, who can watch, and how titles are written.", side: "top" },
];

const SAMPLE = { org: "Opus Esports", event: "Evening Scrims", details: "Sat, 18 Oct · Match 2", map: "Erangel" };

export default function YoutubePage() {
  usePageTour("admin.youtube", TOUR);
  const q = useYoutube();
  const [params, setParams] = useSearchParams();

  // back from Google: say how it went, then tidy the URL
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("error");
    if (!ok && !err) return;
    if (ok) toast.success("YouTube connected", { description: "Streamed matches will now go live on the channel." });
    if (err) toast.error("Couldn't connect YouTube", { description: err });
    setParams({}, { replace: true });
  }, [params, setParams]);

  return (
    <>
      <PageHeader
        eyebrow="Streaming"
        title="YouTube channel"
        description="Connect one YouTube channel. Every match a manager streams goes live there automatically, titled with the organiser, event and match."
      />
      {q.isPending ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : q.isError ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm">{errorMessage(q.error)}</p>
      ) : (
        <div className="grid gap-6">
          {q.data.lastError && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold text-destructive">YouTube had a problem</p>
                <p className="text-sm text-foreground/80">{q.data.lastError}</p>
              </div>
            </div>
          )}
          {!q.data.configured ? <SetupSteps s={q.data} /> : q.data.connected ? <Connected s={q.data} /> : <ConnectCard />}
        </div>
      )}
    </>
  );
}

function ConnectCard() {
  const connect = useConnectYoutube();
  return (
    <section className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6 shadow-sm">
      <span className="grid size-12 place-items-center rounded-xl bg-destructive/10 text-destructive">
        <Youtube className="size-6" />
      </span>
      <div>
        <h2 className="font-display text-2xl font-bold">No channel connected</h2>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Sign in with the Google account that owns the AirBattleground YouTube channel. Live streaming must be turned on for the channel in YouTube Studio.
        </p>
      </div>
      <Button
        size="lg"
        data-tour="yt-connect"
        disabled={connect.isPending}
        onClick={() =>
          connect.mutate(undefined, {
            onSuccess: ({ url }) => window.location.assign(url),
            onError: (e) => toast.error("Couldn't start the sign-in", { description: errorMessage(e) }),
          })
        }
      >
        {connect.isPending ? <Loader2 className="animate-spin" /> : <Youtube />} Connect YouTube
      </Button>
    </section>
  );
}

function Connected({ s }: { s: YoutubeStatus }) {
  const update = useUpdateYoutube();
  const disconnect = useDisconnectYoutube();
  const [confirm, setConfirm] = useState(false);
  const [template, setTemplate] = useState(s.titleTemplate);
  const ch = s.channel!;
  const save = (input: Parameters<typeof update.mutate>[0], done: string) =>
    update.mutate(input, {
      onSuccess: () => toast.success(done),
      onError: (e) => toast.error("Couldn't save", { description: errorMessage(e) }),
    });

  return (
    <>
      <section className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5 shadow-sm" data-tour="yt-connect">
        {ch.thumbnailUrl ? (
          <img src={ch.thumbnailUrl} alt="" className="size-14 rounded-full ring-1 ring-border" />
        ) : (
          <span className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
            <Youtube className="size-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-display text-xl font-bold">
            {ch.title}
            <Badge className="gap-1 bg-success/15 text-success">
              <CheckCircle2 className="size-3.5" /> Connected
            </Badge>
          </p>
          <a href={ch.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
            Open channel <ExternalLink className="size-3.5" />
          </a>
        </div>
        <Button variant="outline" className="text-destructive" onClick={() => setConfirm(true)}>
          <Unplug /> Disconnect
        </Button>
      </section>

      <section className="grid gap-6 rounded-xl border bg-card p-5 shadow-sm sm:p-6" data-tour="yt-settings">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="yt-auto" className="flex items-center gap-2 text-base font-semibold">
              <Radio className="size-4 text-destructive" /> Stream every match
            </Label>
            <p className="text-sm text-muted-foreground">When a manager starts the broadcast output for a match, it also goes live on this channel.</p>
          </div>
          <Switch id="yt-auto" checked={s.autoStream} disabled={update.isPending} onCheckedChange={(on) => save({ autoStream: on }, on ? "Every match will stream to YouTube" : "Streaming to YouTube paused")} />
        </div>

        <div className="grid gap-2">
          <Label className="font-semibold">Who can watch</Label>
          <Select value={s.privacy} onValueChange={(v) => save({ privacy: v as YoutubePrivacy }, "Privacy saved")}>
            <SelectTrigger className="h-11 w-full sm:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YOUTUBE_PRIVACY.map((p) => (
                <SelectItem key={p} value={p}>
                  {YOUTUBE_PRIVACY_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="yt-title" className="font-semibold">
            Video title
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="yt-title" value={template} onChange={(e) => setTemplate(e.target.value)} className="h-11 font-mono text-sm" maxLength={200} />
            <Button
              disabled={update.isPending || template.trim() === s.titleTemplate || template.trim().length < 3}
              onClick={() => save({ titleTemplate: template.trim() }, "Title saved")}
              className="h-11"
            >
              <Save /> Save title
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Fill-ins: {YOUTUBE_TITLE_TOKENS.join(" ")} ·{" "}
            <button type="button" className="underline hover:text-primary" onClick={() => setTemplate(DEFAULT_YOUTUBE_TITLE)}>
              reset
            </button>
          </p>
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Example: </span>
            <span className="font-semibold">{youtubeTitle(template, SAMPLE)}</span>
          </p>
        </div>
      </section>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {ch.title}?</AlertDialogTitle>
            <AlertDialogDescription>Matches stop streaming to YouTube. Streams already on the channel stay there. You can connect again any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disconnect.mutate(undefined, {
                  onSuccess: () => toast.success("YouTube disconnected"),
                  onError: (err) => toast.error("Couldn't disconnect", { description: errorMessage(err) }),
                  onSettled: () => setConfirm(false),
                });
              }}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Shown until the server has a Google client secret: what to do in Google Cloud, in order. */
function SetupSteps({ s }: { s: YoutubeStatus }) {
  const copy = () =>
    void navigator.clipboard.writeText(s.redirectUri).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy — select it and copy by hand"),
    );
  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm" data-tour="yt-connect">
      <h2 className="font-display text-2xl font-bold">One-time setup</h2>
      <p className="mt-1 text-sm text-muted-foreground">The server needs permission to create live streams on YouTube. In Google Cloud Console (the project used for Google sign-in):</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        <li>APIs &amp; Services → Library → enable <b>YouTube Data API v3</b>.</li>
        <li>
          OAuth consent screen → add the scope <code className="rounded bg-muted px-1">…/auth/youtube</code>. Publish the app (Google reviews this scope); while it is in “Testing”, add the channel's Google account as a test user — the connection then lasts 7 days.
        </li>
        <li>
          Credentials → your web OAuth client → <b>Authorised redirect URIs</b> → add:
          <div className="mt-1.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border bg-muted/50 px-3 py-2 text-xs">{s.redirectUri}</code>
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy /> Copy
            </Button>
          </div>
        </li>
        <li>
          On the server, add <code className="rounded bg-muted px-1">GOOGLE_CLIENT_SECRET</code> and <code className="rounded bg-muted px-1">PUBLIC_URL</code> to <code className="rounded bg-muted px-1">.env</code>, then restart the API.
        </li>
        <li>In YouTube Studio, turn on live streaming for the channel (the first time takes up to 24 hours).</li>
      </ol>
    </section>
  );
}
