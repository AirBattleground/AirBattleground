import {
  Ban,
  BadgeCheck,
  Hourglass,
  LogOut,
  MailOpen,
  PartyPopper,
  ShieldX,
  Swords,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { MyTournamentStatus, StageSummary, TeamSummary, TeamTournamentDetail, TournamentDetail } from "@7xen/shared";
import type { Tone } from "@7xen/ui/components/brand/status";
import type { StageFlowYou } from "../shared/StageFlow";
import { fmtWhen, slot2 } from "../shared/format";
import { ordinal } from "@/features/results/components/Rank";

export const stageByOrder = (t: Pick<TournamentDetail, "stages">, order: number | null | undefined): StageSummary | undefined =>
  order == null ? undefined : t.stages.find((s) => s.order === order);

/** True once any stage has been drawn (time preferences and withdrawals are locked then). */
export const isDrawn = (t: Pick<TournamentDetail, "stages">) => t.stages.some((s) => s.status !== "PENDING");

/** Label of a time-slot option id (falls back to formatting the ISO id). */
export function slotLabel(t: Pick<TournamentDetail, "slotOptions">, id: string | null | undefined): string | null {
  if (!id) return null;
  return t.slotOptions.find((o) => o.id === id)?.label ?? fmtWhen(id);
}

/** Where the YOU marker sits in the stage flow. */
export function youFromMe(me: MyTournamentStatus, team: Pick<TeamSummary, "name" | "tag"> | null | undefined, t: Pick<TournamentDetail, "stages">): StageFlowYou | null {
  if (!team) return null;
  const at = me.stageOrder ?? me.entry?.entryStage ?? null;
  switch (me.state) {
    case "WAITLISTED":
      return { team, at: "registration", state: "waitlisted" };
    case "CONFIRMED":
      return me.groupName && at ? { team, at, state: "playing" } : { team, at: "registration", state: "registered" };
    case "INVITED":
      return at ? { team, at, state: "registered" } : null;
    case "PLAYING":
      return at ? { team, at, state: "playing" } : null;
    case "QUALIFIED": {
      if (!at) return null;
      const next = stageByOrder(t, at + 1);
      return { team, at: next ? next.order : at, state: "qualified" };
    }
    case "ELIMINATED":
    case "DISQUALIFIED":
      return at ? { team, at, state: "eliminated" } : null;
    case "CHAMPION":
      return { team, at: "champion", state: "champion" };
    default:
      return null;
  }
}

export interface JourneyCopy {
  icon: LucideIcon;
  tone: Tone;
  eyebrow: string;
  title: string;
  body: string;
  celebrate?: boolean;
}

/** State-specific copy for the "Your journey" card. */
export function journeyCopy(t: TeamTournamentDetail): JourneyCopy {
  const me = t.me;
  const stage = stageByOrder(t, me.stageOrder);
  const next = stageByOrder(t, (me.stageOrder ?? 0) + 1);
  const left = Math.max(0, t.maxTeams - t.confirmedCount);
  const where = me.groupName ? `Group ${me.groupName}` : null;
  switch (me.state) {
    case "NOT_REGISTERED":
      return {
        icon: UserPlus,
        tone: "neutral",
        eyebrow: "Your journey",
        title: "Not registered",
        body: me.canRegister
          ? left > 0
            ? `${left} ${left === 1 ? "spot is" : "spots are"} still open. Register below to grab one.`
            : "All spots are taken, but you can still join the waiting list below."
          : (me.registerBlockedReason ?? "Registration isn't open, but you can follow every match here."),
      };
    case "WITHDRAWN":
      return {
        icon: LogOut,
        tone: "neutral",
        eyebrow: "Your journey",
        title: "You withdrew",
        body: me.canRegister ? "Changed your mind? You can register again while registration is open." : "You're no longer in this tournament. You can still follow the action.",
      };
    case "WAITLISTED":
      return {
        icon: Hourglass,
        tone: "warning",
        eyebrow: "Your journey",
        title: `Waiting list${me.entry?.waitlistPosition ? ` #${me.entry.waitlistPosition}` : ""}`,
        body: "All spots are taken. If a team withdraws before the draw, you move up automatically — we'll show it right here.",
      };
    case "CONFIRMED":
      return {
        icon: BadgeCheck,
        tone: "success",
        eyebrow: "Your journey",
        title: "You're confirmed!",
        body: me.groupName
          ? `You're in Group ${me.groupName}${me.slotNumber != null ? `, slot ${slot2(me.slotNumber)}` : ""}. Get your squad ready.`
          : "Your spot is locked in. Groups and time slots are drawn after registration closes.",
      };
    case "INVITED":
      return {
        icon: MailOpen,
        tone: "info",
        eyebrow: "Your journey",
        title: `Invited to the ${stage?.name ?? "next stage"}`,
        body: `The organiser placed you straight into the ${stage?.name ?? "later stage"}. You'll be seeded once the earlier stage finishes.`,
      };
    case "PLAYING":
      return {
        icon: Swords,
        tone: "brand",
        eyebrow: stage ? `${stage.name} · in progress` : "In progress",
        title: `Playing in ${where ?? "your group"}${me.slotNumber != null ? `, slot ${slot2(me.slotNumber)}` : ""}`,
        body: me.groupRank ? `You're currently ${ordinal(me.groupRank)} in ${where ?? "your group"}.` : "Your group's points table fills in as results are published.",
      };
    case "QUALIFIED":
      return {
        icon: PartyPopper,
        tone: "success",
        eyebrow: stage ? `${stage.name} · done` : "Stage done",
        title: "Qualified 🎉",
        body: next ? `You're through to the ${next.name}. Great run — now do it again.` : "You made it through. Great run!",
        celebrate: true,
      };
    case "ELIMINATED":
      return {
        icon: ShieldX,
        tone: "neutral",
        eyebrow: stage ? `${stage.name} · done` : "Your journey",
        title: "Eliminated",
        body: `Your run ended in the ${stage?.name ?? "tournament"}${me.groupRank && where ? ` — ${ordinal(me.groupRank)} in ${where}` : ""}. You can still follow the action.`,
      };
    case "DISQUALIFIED":
      return {
        icon: Ban,
        tone: "danger",
        eyebrow: "Your journey",
        title: "Disqualified",
        body: "The organiser disqualified your team from this tournament. Contact them if you think this is a mistake.",
      };
    case "CHAMPION":
      return {
        icon: Trophy,
        tone: "warning",
        eyebrow: "Tournament complete",
        title: "Champion 🏆",
        body: `You won ${t.title}. Legendary.`,
        celebrate: true,
      };
  }
}

/** Short chip text for list cards ("You're in — Group C"). */
export function meChip(me: MyTournamentStatus): { text: string; tone: Tone } | null {
  switch (me.state) {
    case "CONFIRMED":
      return { text: me.groupName ? `You're in — Group ${me.groupName}` : "You're in", tone: "success" };
    case "PLAYING":
      return { text: `Playing — Group ${me.groupName ?? "?"}${me.slotNumber != null ? ` · ${slot2(me.slotNumber)}` : ""}`, tone: "brand" };
    case "WAITLISTED":
      return { text: `Waiting list${me.entry?.waitlistPosition ? ` #${me.entry.waitlistPosition}` : ""}`, tone: "warning" };
    case "INVITED":
      return { text: "Invited", tone: "info" };
    case "QUALIFIED":
      return { text: "Qualified 🎉", tone: "success" };
    case "ELIMINATED":
      return { text: "Eliminated", tone: "neutral" };
    case "DISQUALIFIED":
      return { text: "Disqualified", tone: "danger" };
    case "CHAMPION":
      return { text: "Champion 🏆", tone: "warning" };
    default:
      return null;
  }
}
