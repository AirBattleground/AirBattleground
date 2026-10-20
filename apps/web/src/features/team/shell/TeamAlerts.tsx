import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, Lightbulb, Radio, UserPlus } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@7xen/ui/components/ui/popover";
import { cn } from "@7xen/ui/lib/utils";
import { usePlayerSession } from "@/lib/auth";
import { useLiveBroadcasts } from "@/features/broadcast/live";
import { usePlayerTeam } from "@/features/player/api";

interface Alert {
  key: string;
  to: string;
  icon: ReactNode;
  tone: string;
  title: string;
  text: string;
}

/**
 * Header bell built from what the portal already polls: matches being streamed now, and (leaders) join
 * requests and "Ask my leader" suggestions. Each row links to where it's handled.
 */
export function TeamAlerts() {
  const [open, setOpen] = useState(false);
  const { hasTeam, isLeader } = usePlayerSession();
  const live = useLiveBroadcasts().data ?? [];
  // same query (and poll) the layout already runs for the leader nav badges
  const team = usePlayerTeam({ enabled: hasTeam && isLeader }).data;
  const requests = isLeader ? (team?.joinRequests.length ?? 0) : 0;
  const suggestions = isLeader ? (team?.openSuggestions ?? 0) : 0;

  const alerts: Alert[] = [
    ...live.map((b) => ({
      key: `live-${b.matchId}`,
      to: `/team/live/${b.matchId}`,
      icon: <Radio />,
      tone: "bg-destructive/12 text-destructive",
      title: `Live now: ${b.title}`,
      text: `${b.subtitle} · by ${b.organizer.name}`,
    })),
    ...(requests > 0
      ? [{ key: "requests", to: "/team/my-team", icon: <UserPlus />, tone: "bg-primary/12 text-primary", title: `${requests} ${requests === 1 ? "player wants" : "players want"} to join`, text: "Accept or decline on My team." }]
      : []),
    ...(suggestions > 0
      ? [{ key: "suggestions", to: "/team", icon: <Lightbulb />, tone: "bg-warning/15 text-warning-foreground dark:text-warning", title: `${suggestions} ${suggestions === 1 ? "match" : "matches"} asked by your team`, text: "Register in one tap, or dismiss." }]
      : []),
  ];
  const count = alerts.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={count ? `Alerts (${count})` : "Alerts"} data-tour="alerts" className="relative size-9 text-muted-foreground hover:text-foreground">
          <Bell className="size-5" />
          {count > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-white ring-2 ring-background">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Alerts</p>
        {count === 0 ? (
          <div className="flex flex-col items-center px-6 py-8 text-center">
            <BellOff className="size-8 text-muted-foreground/60" />
            <p className="mt-2 text-sm font-medium">You're all caught up</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Live matches and team requests show up here.</p>
          </div>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {alerts.map((a) => (
              <li key={a.key}>
                <Link to={a.to} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60">
                  <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4", a.tone)}>{a.icon}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{a.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{a.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
