import type { ReactNode } from "react";
import { CalendarCheck, Crown, Hourglass, IdCard, Info, Trophy, UserRound } from "lucide-react";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAuth } from "@/lib/auth";
import { useTeamDashboard } from "@/features/team/api";
import { RosterEditor } from "@/features/results/components/RosterEditor";

const STEPS: TourStep[] = [
  { title: "Your team profile", description: "Your team's identity on 7xen and a quick summary of your activity." },
  { element: '[data-tour="team-card"]', title: "Team identity", description: "Your team name, tag and captain as organisers see them.", side: "bottom" },
  { element: '[data-tour="profile-stats"]', title: "Your activity", description: "Upcoming approved matches, requests waiting, and matches played.", side: "top" },
  { element: '[data-tour="roster"]', title: "Your roster", description: "Add your players' in-game names. Matching names lets 7xen read your results from screenshots automatically.", side: "top" },
  { element: '[data-tour="profile-help"]', title: "Need a change?", description: "Team details are managed by the 7xen admin. Contact them to rename your team or change the tag.", side: "top" },
];

function Field({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background/60 p-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-4">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

const Num = ({ v }: { v: number | undefined }) => (v === undefined ? <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" /> : <>{v}</>);

export default function ProfilePage() {
  usePageTour("team.profile", STEPS);
  const { user } = useAuth();
  const q = useTeamDashboard();
  const team = q.data?.team;
  const name = team?.name ?? user?.team?.name ?? user?.displayName ?? "Your team";
  const tag = team?.tag ?? user?.team?.tag;
  const captain = team?.captainName;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Profile" title="Team profile" description="How your team appears to organisers on 7xen." className="mb-0" />

      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm" data-tour="team-card">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-grid opacity-70" />
        <div className="relative flex flex-col gap-6 p-5 pt-10 sm:flex-row sm:items-end sm:p-7 sm:pt-12">
          <TeamAvatar name={name} tag={tag} size="lg" className="size-24 rounded-2xl text-2xl shadow-glow ring-4 ring-card" />
          <div className="min-w-0 flex-1">
            {tag && <p className="font-display text-sm font-bold tracking-[0.3em] text-primary">[{tag}]</p>}
            <h2 className="truncate font-display text-3xl font-bold sm:text-4xl">{name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Battlegrounds squad · 7xen scrims</p>
          </div>
        </div>
        <div className="relative grid gap-3 border-t p-5 sm:grid-cols-3 sm:p-7">
          <Field icon={<Crown />} label="Captain" value={captain ?? <span className="text-muted-foreground">Not set</span>} />
          <Field icon={<UserRound />} label="Login username" value={user?.username ?? "—"} />
          <Field icon={<IdCard />} label="Team tag" value={tag ?? "—"} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3" data-tour="profile-stats">
        <StatCard label="Approved upcoming" value={<Num v={q.data?.counts.approvedUpcoming} />} icon={<CalendarCheck />} tone="success" />
        <StatCard label="Waiting for approval" value={<Num v={q.data?.counts.pending} />} icon={<Hourglass />} tone="warning" />
        <StatCard label="Matches played" value={<Num v={q.data?.counts.totalPlayed} />} icon={<Trophy />} tone="brand" />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/10 p-4 text-sm" data-tour="profile-help">
        <Info className="mt-0.5 size-5 shrink-0 text-info" />
        <p>
          <span className="font-semibold">To change team details, contact the 7xen admin.</span>{" "}
          <span className="text-muted-foreground">Team name, tag, captain and login are managed by the admin.</span>
        </p>
      </div>

      <RosterEditor />
    </div>
  );
}
