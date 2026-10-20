import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Search, Swords, Trophy } from "lucide-react";
import { addDays, MAP_LABELS, TOURNAMENT_STATUS_LABELS, todayInAppTz } from "@7xen/shared";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@7xen/ui/components/ui/command";
import { Button } from "@7xen/ui/components/ui/button";
import { useTeamScrims } from "@/features/team/api";
import { formatTime } from "@/features/team/format";
import { useTeamTournaments } from "@/features/tournaments/team/api";

export interface SearchPage {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Results, mounted only while the dialog is open (so nothing loads until someone searches). */
function Results({ pages, go }: { pages: SearchPage[]; go: (to: string) => void }) {
  const today = todayInAppTz();
  const tomorrow = addDays(today, 1);
  const tournaments = useTeamTournaments().data ?? [];
  const todays = useTeamScrims(today).data ?? [];
  const tomorrows = useTeamScrims(tomorrow).data ?? [];
  const scrims = [...todays.map((s) => ({ s, day: "Today" })), ...tomorrows.map((s) => ({ s, day: "Tomorrow" }))].filter(({ s }) => s.registrationOpen);

  return (
    <CommandList className="max-h-[min(60vh,28rem)]">
      <CommandEmpty>Nothing found. Try a scrim, tournament or organiser name.</CommandEmpty>
      {tournaments.length > 0 && (
        <CommandGroup heading="Tournaments">
          {tournaments.map((t) => (
            <CommandItem key={t.id} value={`tournament ${t.title} ${t.manager.displayName} ${t.id}`} onSelect={() => go(`/team/tournaments/${t.id}`)}>
              <Trophy className="text-primary" />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{TOURNAMENT_STATUS_LABELS[t.status]}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {scrims.length > 0 && (
        <CommandGroup heading="Scrims open for registration">
          {scrims.map(({ s, day }) => (
            <CommandItem
              key={`${s.scrim.id}-${s.date}`}
              value={`scrim ${s.scrim.title} ${s.scrim.manager.displayName} ${s.scrim.maps.map((m) => MAP_LABELS[m]).join(" ")} ${day} ${s.scrim.id} ${s.date}`}
              onSelect={() => go(s.date === today ? "/team/scrims" : `/team/scrims?date=${s.date}`)}
            >
              <Swords className="text-primary" />
              <span className="min-w-0 flex-1 truncate">{s.scrim.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {day} · {formatTime(s.scrim.startTime)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      <CommandGroup heading="Pages">
        {pages.map((p) => (
          <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(p.to)}>
            <p.icon />
            {p.label}
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  );
}

/**
 * Header search for the player portal: a search field on desktop (an icon on phones) that opens a
 * quick-jump over open tournaments, today's/tomorrow's scrims and the portal's pages. Ctrl/⌘ + K opens it.
 */
export function TeamSearch({ pages }: { pages: SearchPage[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="search"
        className="hidden h-11 w-full max-w-[26rem] items-center gap-3 rounded-xl border bg-background/40 px-4 text-left text-sm text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:bg-background/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:flex"
      >
        <Search className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search tournaments, scrims, pages…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground xl:inline">Ctrl K</kbd>
      </button>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Search" className="ml-auto size-9 text-muted-foreground lg:hidden">
        <Search className="size-5" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find tournaments, scrims and pages">
        <CommandInput placeholder="Search tournaments, scrims, pages…" />
        {open && <Results pages={pages} go={go} />}
      </CommandDialog>
    </>
  );
}
