import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ChevronRight, RefreshCw, SearchX, Shield, UserRound } from "lucide-react";
import { MAX_TEAM_MEMBERS, type TeamRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@7xen/ui/components/ui/table";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { PlayerAvatar, playerName } from "@/components/PlayerAvatar";
import { SearchInput } from "@/components/SearchInput";
import { useTeams } from "@/features/teams/api";
import { TeamDetailSheet } from "@/features/teams/TeamDetailSheet";
import { useDebounced } from "@/hooks/use-debounce";
import { useIsDesktop } from "@/hooks/use-media-query";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Teams", description: "Players create their own teams now. Here you can see every team, who leads it and who plays in it." },
  { element: '[data-tour="search"]', title: "Search", description: "Find a team by its name or tag.", side: "bottom" },
  { element: '[data-tour="teams-list"]', title: "Every team on AirBattleground", description: "Leader, how many players and how many scrims they've registered for. Click a team to see its members.", side: "top" },
];

function Leader({ t }: { t: TeamRow }) {
  if (!t.leader) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PlayerAvatar player={t.leader} size="sm" />
      <span className="truncate">{playerName(t.leader)}</span>
    </span>
  );
}

export default function TeamsPage() {
  usePageTour("admin.teams", TOUR);
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  // ?q= prefills the search, ?team=<id> opens a team's detail sheet
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const q = useDebounced(search.trim(), 300);
  const list = useTeams(q);
  const openId = params.get("team");
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set("team", id);
        else next.delete("team");
        return next;
      },
      { replace: true },
    );
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(id);
    }
  };

  const items = list.data?.items ?? [];

  let body: ReactNode;
  if (list.isPending) body = <ListSkeleton />;
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load teams"
        description={errorMessage(list.error)}
        action={
          <Button variant="outline" onClick={() => list.refetch()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    );
  else if (!items.length)
    body = q ? (
      <EmptyState icon={<SearchX />} title="No teams match" description={`Nothing found for "${q}". Check the spelling or clear the search.`} action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>} />
    ) : (
      <EmptyState icon={<Shield />} title="No teams yet" description="Players create teams themselves after signing in with Google. They'll show up here as soon as the first one is made." />
    );
  else if (isDesktop)
    body = (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Team</TableHead>
              <TableHead>Leader</TableHead>
              <TableHead className="text-right">Players</TableHead>
              <TableHead className="text-right">Registrations</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10 pr-4"><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((t, i) => (
              <motion.tr
                key={t.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                tabIndex={0}
                role="button"
                aria-label={`Open ${t.name}`}
                onClick={() => setOpen(t.id)}
                onKeyDown={onKey(t.id)}
                className="group cursor-pointer border-b transition-colors outline-none last:border-0 hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <TeamAvatar name={t.name} tag={t.tag} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="text-xs font-semibold tracking-wider text-primary">[{t.tag}]</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[14rem]"><Leader t={t} /></TableCell>
                <TableCell className="text-right font-display text-lg font-bold">
                  {t.memberCount}
                  <span className="ml-0.5 text-sm font-semibold text-muted-foreground">/{MAX_TEAM_MEMBERS}</span>
                </TableCell>
                <TableCell className="text-right font-display text-lg font-bold">{t.registrationCount}</TableCell>
                <TableCell className="text-muted-foreground" title={shortDate(t.createdAt)}>{relativeTime(t.createdAt)}</TableCell>
                <TableCell className="pr-4 text-right">
                  <ChevronRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  else
    body = (
      <ul className="grid grid-cols-1 gap-3">
        {items.map((t, i) => (
          <motion.li key={t.id} className="min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.03 }}>
            <button
              type="button"
              onClick={() => setOpen(t.id)}
              className="w-full rounded-xl border bg-card p-4 text-left shadow-sm outline-none transition-colors hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <TeamAvatar name={t.name} tag={t.tag} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {t.name} <span className="text-xs font-semibold tracking-wider text-primary">[{t.tag}]</span>
                  </div>
                  <div className="mt-1 text-sm"><Leader t={t} /></div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span><strong className="font-display text-sm text-foreground">{t.memberCount}</strong>/{MAX_TEAM_MEMBERS} players</span>
                <span><strong className="font-display text-sm text-foreground">{t.registrationCount}</strong> registrations</span>
                <span>Created {relativeTime(t.createdAt)}</span>
              </div>
            </button>
          </motion.li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="Players" title="Teams" description="Teams are made by players. Open one to see its members, or disband it if needed." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search teams…" loading={list.isFetching && !list.isPending} data-tour="search" />
        {list.data && <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "team" : "teams"}{q && " found"}</p>}
      </div>
      {/* Phones have no "Players" tab (folded into Teams), so link to it from here. */}
      {!isDesktop && (
        <Link to="/players" className="mb-4 flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/50">
          <UserRound className="size-5 text-primary" />
          <span className="min-w-0 flex-1 font-medium">Players</span>
          <span className="text-xs text-muted-foreground">Everyone who signed up</span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      )}
      <div data-tour="teams-list">{body}</div>
      <TeamDetailSheet teamId={openId} onClose={() => setOpen(null)} />
    </>
  );
}
