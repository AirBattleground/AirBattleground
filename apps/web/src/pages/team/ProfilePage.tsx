import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import { ArrowRight, CalendarCheck, Crown, Gamepad2, Hash, Hourglass, Loader2, Mail, Save, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import { bgmiIdSchema, ignSchema } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { PageHeader, StatCard } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { usePlayerSession } from "@/lib/auth";
import { useTeamDashboard } from "@/features/team/api";
import { usePlayerProfile, useUpdateProfile } from "@/features/player/api";
import { applyApiError, BGMI_HINT, Field } from "@/features/player/forms";
import { PlayerAvatar } from "@/features/player/components/PlayerAvatar";

const STEPS: TourStep[] = [
  { title: "Your player profile", description: "Your name and BGMI ID as teams and organisers see them." },
  { element: '[data-tour="player-card"]', title: "You", description: "Your Google picture and email. Only your IGN is shown to other players.", side: "bottom" },
  { element: '[data-tour="player-form"]', title: "IGN & BGMI ID", description: "Keep these exactly as in the game — results are matched to your name.", side: "top" },
  { element: '[data-tour="profile-team"]', title: "Your team", description: "Your team at a glance. Open My team to invite players or manage the squad.", side: "top" },
];

const schema = z.object({ ign: ignSchema, bgmiId: z.union([bgmiIdSchema, z.literal("")]) });
type Values = z.infer<typeof schema>;

const Num = ({ v }: { v: number | undefined }) => (v === undefined ? <span className="inline-block h-9 w-10 animate-pulse rounded bg-muted" /> : <>{v}</>);

function Info({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border bg-background/60 p-3">
      <div className="rounded-lg bg-primary/10 p-2 text-primary [&_svg]:size-4">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
        <p className="truncate font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  usePageTour("team.profile", STEPS);
  const { user, player, team, hasTeam } = usePlayerSession();
  const profile = usePlayerProfile();
  const update = useUpdateProfile();
  const dash = useTeamDashboard({ enabled: hasTeam });
  const p = profile.data;
  const ign = p?.ign ?? player?.ign ?? "";
  const bgmiId = p?.bgmiId ?? player?.bgmiId ?? "";
  const shownName = ign || user?.displayName || "Player";

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { ign, bgmiId } });
  const { register, handleSubmit, setError, formState, reset } = form;
  useEffect(() => reset({ ign, bgmiId }), [ign, bgmiId, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({ ign: v.ign, bgmiId: v.bgmiId });
      toast.success("Profile saved");
    } catch (e) {
      const left = applyApiError(e, setError, ["ign", "bgmiId"]);
      if (left) toast.error("Couldn't save", { description: left });
    }
  });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Profile" title="My profile" description="How you appear to your team and to organisers." className="mb-0" />

      <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm" data-tour="player-card">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-grid opacity-70" />
        <div className="relative flex flex-col gap-5 p-5 pt-10 sm:flex-row sm:items-end sm:p-7 sm:pt-12">
          <PlayerAvatar name={shownName} url={player?.avatarUrl} size="xl" className="size-24 rounded-2xl shadow-glow ring-4 ring-card" />
          <div className="min-w-0 flex-1">
            {team && (
              <p className="font-display text-sm font-bold tracking-[0.3em] text-primary">
                [{team.tag}] {team.role === "LEADER" && <Crown className="inline size-4 -translate-y-px text-warning" />}
              </p>
            )}
            <h2 className="truncate font-display text-3xl font-bold sm:text-4xl">{shownName}</h2>
            <p className="mt-1 truncate text-sm text-muted-foreground">{user?.displayName}</p>
          </div>
        </div>
        <div className="relative grid gap-3 border-t p-5 sm:grid-cols-3 sm:p-7">
          <Info icon={<Mail />} label="Google account" value={player?.email ?? p?.email ?? "—"} />
          <Info icon={<Hash />} label="BGMI ID" value={bgmiId ? <span className="font-mono">{bgmiId}</span> : <span className="text-muted-foreground">Not added yet</span>} />
          <Info icon={<CalendarCheck />} label="Player since" value={p ? format(parseISO(p.createdAt), "d MMM yyyy") : "—"} />
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" data-tour="player-form">
        <h2 className="font-display text-xl font-bold">Game details</h2>
        <p className="text-sm text-muted-foreground">Use your exact in-game name so results match you automatically.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="ign" label="In-game name (IGN)" error={formState.errors.ign?.message}>
            <div className="relative">
              <Gamepad2 aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="ign" className="h-11 pl-9" aria-invalid={!!formState.errors.ign} {...register("ign")} />
            </div>
          </Field>
          <Field id="bgmiId" label="BGMI ID" error={formState.errors.bgmiId?.message} hint={BGMI_HINT}>
            <div className="relative">
              <Hash aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="bgmiId" inputMode="numeric" placeholder="5123456789" className="h-11 pl-9 font-mono tracking-wider" aria-invalid={!!formState.errors.bgmiId} {...register("bgmiId")} />
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={!formState.isDirty || formState.isSubmitting} className="w-full sm:w-auto">
            {formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />} {formState.isDirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </form>

      <section className="space-y-4" data-tour="profile-team">
        {team ? (
          <>
            <div className="flex flex-col gap-4 rounded-2xl border border-primary/25 bg-card p-5 shadow-sm sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <TeamAvatar name={team.name} tag={team.tag} size="lg" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.2em] text-primary uppercase">Your team</p>
                  <p className="truncate font-display text-2xl leading-tight font-bold uppercase">{team.name}</p>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    {team.role === "LEADER" ? <Crown className="size-4 text-warning" /> : <Users className="size-4" />}
                    {team.role === "LEADER" ? "You lead this team" : "Member"}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline">
                <Link to="/team/my-team">
                  Open My team <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Approved upcoming" value={<Num v={dash.data?.counts.approvedUpcoming} />} icon={<CalendarCheck />} tone="success" />
              <StatCard label="Waiting for approval" value={<Num v={dash.data?.counts.pending} />} icon={<Hourglass />} tone="warning" />
              <StatCard label="Matches played" value={<Num v={dash.data?.counts.totalPlayed} />} icon={<Trophy />} tone="brand" />
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed bg-card/60 p-5 sm:flex-row sm:items-center">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl font-bold">No team yet</p>
              <p className="text-sm text-muted-foreground">Create your own team or join one with an invite code.</p>
            </div>
            <Button asChild>
              <Link to="/team">
                Get into a team <ArrowRight />
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
