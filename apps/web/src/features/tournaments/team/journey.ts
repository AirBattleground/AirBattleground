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
import { ordFor, staticT, tJourney, type Tr } from "@/i18n/tournaments";

type JT = Tr<(typeof tJourney)["en"]>;
const EN = staticT(tJourney);

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

interface JourneyCopy {
  icon: LucideIcon;
  tone: Tone;
  eyebrow: string;
  title: string;
  body: string;
  celebrate?: boolean;
}

/** State-specific copy for the "Your journey" card. Pass `tr` (useT(tJourney)) for the player's language; English otherwise. */
export function journeyCopy(t: TeamTournamentDetail, tr: JT = EN): JourneyCopy {
  const me = t.me;
  const stage = stageByOrder(t, me.stageOrder);
  const next = stageByOrder(t, (me.stageOrder ?? 0) + 1);
  const left = Math.max(0, t.maxTeams - t.confirmedCount);
  const where = me.groupName ? tr("group_where", { group: me.groupName }) : null;
  const rank = (n: number) => ordFor(tr.lang, n);
  const eyebrow = tr("your_journey");
  switch (me.state) {
    case "NOT_REGISTERED":
      return {
        icon: UserPlus,
        tone: "neutral",
        eyebrow,
        title: tr("not_registered_title"),
        body: me.canRegister
          ? left > 0
            ? tr.plural("spots_open", left)
            : tr("all_taken_waitlist")
          : (me.registerBlockedReason ?? tr("reg_not_open_follow")),
      };
    case "WITHDRAWN":
      return {
        icon: LogOut,
        tone: "neutral",
        eyebrow,
        title: tr("withdrew_title"),
        body: me.canRegister ? tr("withdrew_can") : tr("withdrew_cant"),
      };
    case "WAITLISTED":
      return {
        icon: Hourglass,
        tone: "warning",
        eyebrow,
        title: me.entry?.waitlistPosition ? tr("waitlist_pos", { pos: me.entry.waitlistPosition }) : tr("waitlist_title"),
        body: tr("waitlist_body"),
      };
    case "CONFIRMED":
      return {
        icon: BadgeCheck,
        tone: "success",
        eyebrow,
        title: tr("confirmed_title"),
        body: me.groupName
          ? me.slotNumber != null
            ? tr("confirmed_group_slot", { group: me.groupName, slot: slot2(me.slotNumber) })
            : tr("confirmed_group", { group: me.groupName })
          : tr("confirmed_locked"),
      };
    case "INVITED":
      return {
        icon: MailOpen,
        tone: "info",
        eyebrow,
        title: tr("invited_title", { stage: stage?.name ?? tr("next_stage") }),
        body: tr("invited_body", { stage: stage?.name ?? tr("later_stage") }),
      };
    case "PLAYING": {
      const w = where ?? tr("your_group");
      return {
        icon: Swords,
        tone: "brand",
        eyebrow: stage ? tr("stage_in_progress", { stage: stage.name }) : tr("in_progress"),
        title: me.slotNumber != null ? tr("playing_title_slot", { where: w, slot: slot2(me.slotNumber) }) : tr("playing_title", { where: w }),
        body: me.groupRank ? tr("playing_rank", { rank: rank(me.groupRank), where: w }) : tr("playing_wait"),
      };
    }
    case "QUALIFIED":
      return {
        icon: PartyPopper,
        tone: "success",
        eyebrow: stage ? tr("stage_done", { stage: stage.name }) : tr("stage_done_plain"),
        title: tr("qualified_title"),
        body: next ? tr("qualified_next", { stage: next.name }) : tr("qualified_plain"),
        celebrate: true,
      };
    case "ELIMINATED": {
      const st = stage?.name ?? tr("tournament_word");
      return {
        icon: ShieldX,
        tone: "neutral",
        eyebrow: stage ? tr("stage_done", { stage: stage.name }) : eyebrow,
        title: tr("eliminated_title"),
        body: me.groupRank && where ? tr("eliminated_body_rank", { stage: st, rank: rank(me.groupRank), where }) : tr("eliminated_body", { stage: st }),
      };
    }
    case "DISQUALIFIED":
      return {
        icon: Ban,
        tone: "danger",
        eyebrow,
        title: tr("dq_title"),
        body: tr("dq_body"),
      };
    case "CHAMPION":
      return {
        icon: Trophy,
        tone: "warning",
        eyebrow: tr("complete"),
        title: tr("champion_title"),
        body: tr("champion_body", { title: t.title }),
        celebrate: true,
      };
  }
}

/** Short chip text for list cards ("You're in — Group C"). Pass `tr` (useT(tJourney)) for the player's language. */
export function meChip(me: MyTournamentStatus, tr: JT = EN): { text: string; tone: Tone } | null {
  switch (me.state) {
    case "CONFIRMED":
      return { text: me.groupName ? tr("chip_in_group", { group: me.groupName }) : tr("chip_in"), tone: "success" };
    case "PLAYING":
      return { text: `${tr("chip_playing", { group: me.groupName ?? "?" })}${me.slotNumber != null ? ` · ${slot2(me.slotNumber)}` : ""}`, tone: "brand" };
    case "WAITLISTED":
      return { text: me.entry?.waitlistPosition ? tr("waitlist_pos", { pos: me.entry.waitlistPosition }) : tr("waitlist_title"), tone: "warning" };
    case "INVITED":
      return { text: tr("chip_invited"), tone: "info" };
    case "QUALIFIED":
      return { text: tr("qualified_title"), tone: "success" };
    case "ELIMINATED":
      return { text: tr("chip_eliminated"), tone: "neutral" };
    case "DISQUALIFIED":
      return { text: tr("chip_dq"), tone: "danger" };
    case "CHAMPION":
      return { text: tr("champion_title"), tone: "warning" };
    default:
      return null;
  }
}
