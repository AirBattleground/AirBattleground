import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Crown, Mail, RefreshCw, SearchX, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { AdminPlayerRow } from "@7xen/shared";
import { EmptyState, PageHeader } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Switch } from "@7xen/ui/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@7xen/ui/components/ui/table";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { ListSkeleton } from "@/components/ListSkeleton";
import { PlayerAvatar, playerName } from "@/components/PlayerAvatar";
import { SearchInput } from "@/components/SearchInput";
import { ToggleActiveDialog, type ToggleTarget } from "@/components/ToggleActiveDialog";
import { usePlayers, useSetPlayerActive } from "@/features/players/api";
import { useDebounced } from "@/hooks/use-debounce";
import { useIsDesktop } from "@/hooks/use-media-query";
import { errorMessage } from "@/lib/forms";
import { relativeTime, shortDate } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Players", description: "Everyone who signed up with Google. Players make their own accounts — you don't need to create anything." },
  { element: '[data-tour="search"]', title: "Search", description: "Find a player by in-game name, name, email or BGMI ID.", side: "bottom" },
  { element: '[data-tour="players-list"]', title: "Every player", description: "Their BGMI ID, which team they're in (and whether they lead it), and when they last signed in.", side: "top" },
  { element: '[data-tour="active-switch"]', title: "Turn an account off", description: "Switch a player off to stop them signing in. Switch them back on any time.", side: "left" },
];

function TeamCell({ p }: { p: AdminPlayerRow }) {
  if (!p.team) return <span className="text-muted-foreground">No team</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Link to={`/teams?team=${p.team.id}`} className="truncate font-medium hover:text-primary hover:underline">
        {p.team.name} <span className="text-xs font-semibold tracking-wider text-primary">[{p.team.tag}]</span>
      </Link>
      {p.team.role === "LEADER" && (
        <Pill tone="warning" icon={<Crown className="size-3" />}>
          Leader
        </Pill>
      )}
    </span>
  );
}

export default function PlayersPage() {
  usePageTour("admin.players", TOUR);
  const isDesktop = useIsDesktop();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const list = usePlayers(q);
  const setActive = useSetPlayerActive();
  const [toggling, setToggling] = useState<ToggleTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const save = async (t: ToggleTarget) => {
    setBusyId(t.id);
    try {
      await setActive.mutateAsync({ id: t.id, isActive: !t.isActive });
      toast.success(t.isActive ? `${t.name} is disabled` : `${t.name} can sign in again`);
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    } finally {
      setBusyId(null);
    }
  };

  const activeSwitch = (p: AdminPlayerRow, i: number) => {
    const target = { id: p.id, name: playerName(p), isActive: p.isActive };
    return (
      <Switch
        checked={p.isActive}
        disabled={busyId === p.id}
        data-tour={i === 0 ? "active-switch" : undefined}
        aria-label={p.isActive ? `Disable ${target.name}` : `Enable ${target.name}`}
        onCheckedChange={(on) => (on ? save(target).catch(() => {}) : setToggling(target))}
      />
    );
  };

  const items = list.data?.items ?? [];

  let body: ReactNode;
  if (list.isPending) body = <ListSkeleton />;
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load players"
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
      <EmptyState icon={<SearchX />} title="No players match" description={`Nothing found for "${q}". Try their in-game name, email or BGMI ID.`} action={<Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>} />
    ) : (
      <EmptyState
        icon={<UserRound />}
        title="No players yet"
        description="Players sign up themselves with “Continue with Google” on the AirBattleground login page. Share the site link with your community — they'll appear here as soon as they join."
      />
    );
  else if (isDesktop)
    body = (
      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">Player</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>BGMI ID</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="pr-4 text-right">Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p, i) => (
              <motion.tr
                key={p.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className="border-b transition-colors last:border-0 hover:bg-muted/50"
              >
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar player={p} size="lg" className={cn(!p.isActive && "opacity-50 grayscale")} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.ign ?? <span className="text-muted-foreground italic">No IGN yet</span>}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.displayName}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="max-w-[14rem] truncate text-muted-foreground" title={p.email ?? undefined}>{p.email ?? "—"}</TableCell>
                <TableCell className="font-mono text-sm">{p.bgmiId ?? <span className="font-sans text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-[14rem]"><TeamCell p={p} /></TableCell>
                <TableCell className="text-muted-foreground" title={p.lastLoginAt ?? undefined}>{relativeTime(p.lastLoginAt)}</TableCell>
                <TableCell className="text-muted-foreground">{shortDate(p.createdAt)}</TableCell>
                <TableCell className="pr-4 text-right">{activeSwitch(p, i)}</TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  else
    body = (
      <ul className="grid grid-cols-1 gap-3">
        {items.map((p, i) => (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 10) * 0.03 }}
            className="min-w-0 rounded-xl border bg-card p-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <PlayerAvatar player={p} size="lg" className={cn(!p.isActive && "opacity-50 grayscale")} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.ign ?? <span className="text-muted-foreground italic">No IGN yet</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{p.displayName}</div>
              </div>
              {activeSwitch(p, i)}
            </div>
            <div className="mt-3 grid gap-1.5 text-sm">
              <TeamCell p={p} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>BGMI ID <span className="font-mono text-foreground">{p.bgmiId ?? "—"}</span></span>
                <span>Last login {relativeTime(p.lastLoginAt).toLowerCase()}</span>
                <span>Joined {shortDate(p.createdAt)}</span>
              </div>
              {p.email && (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <Mail className="size-3 shrink-0" />
                  <span className="truncate">{p.email}</span>
                </span>
              )}
            </div>
          </motion.li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader eyebrow="Accounts" title="Players" description="Everyone who signed up with Google. Search, see their team, or turn an account off." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search players…" loading={list.isFetching && !list.isPending} data-tour="search" />
        {list.data && <p className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "player" : "players"}{q && " found"}</p>}
      </div>
      <div data-tour="players-list">{body}</div>
      <ToggleActiveDialog kind="player" target={toggling} onClose={() => setToggling(null)} onConfirm={save} />
    </>
  );
}
