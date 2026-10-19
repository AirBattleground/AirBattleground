import { Link } from "react-router-dom";
import { Search, Sparkles, Trophy } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";
import { formatDate } from "../format";
import { Backdrop, Wordmark } from "./HomeHero";

/** Phase 5c: home hero for a player who isn't in a team yet — greets them by IGN, browsing is the main action. */
export function PlayerHero({ name, avatarUrl, greeting, today, backdropUrl }: { name: string; avatarUrl?: string | null; greeting: string; today: string; backdropUrl: string | null }) {
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-primary/20 bg-card shadow-sm animate-rise" data-tour="home-hero">
      <Backdrop url={backdropUrl} />
      <div className="p-5 sm:p-8 lg:p-10">
        <div className="flex flex-wrap items-center gap-3">
          <Wordmark />
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.2em] text-primary uppercase">Player hub</span>
        </div>
        <div className="mt-6 flex items-center gap-4 sm:mt-8">
          <div className="relative shrink-0">
            <div className="absolute -inset-1.5 rounded-2xl bg-gradient-to-br from-primary to-brand-300 opacity-60 blur-md" aria-hidden />
            <PlayerAvatar name={name} url={avatarUrl} size="xl" className="relative ring-2 ring-primary/60" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              {greeting}
              <span className="hidden sm:inline"> · {formatDate(today, "EEEE, d MMM")}</span>
            </p>
            <h1 className="mt-1 truncate font-display text-3xl leading-[1.05] font-extrabold tracking-tight uppercase sm:text-5xl">{name}</h1>
            <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.2em] text-primary uppercase">
              <Sparkles className="size-3" /> Free agent
            </p>
          </div>
        </div>
        <p className="mt-5 max-w-md text-sm text-muted-foreground sm:text-base">See what's on today — scrims, tournaments and the organisers running them.</p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Button asChild size="lg" className="h-12 flex-1 px-6 text-base shadow-glow sm:flex-none" data-tour="find-scrim">
            <Link to="/team/scrims">
              <Search /> Find a scrim
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 bg-background/60 backdrop-blur">
            <Link to="/team/tournaments">
              <Trophy /> Tournaments
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
