import { Fragment } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, ClipboardList, Crown, Shield, Swords, Trophy, type LucideIcon } from "lucide-react";
import type { FormatIssue, StageSpec } from "@7xen/shared";
import { cn } from "@7xen/ui/lib/utils";
import { teamsOut } from "../engine";
import { AnimatedNumber } from "./form";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Live preview of a format being edited: Registration → stages → 🏆 with the team counts on every arrow.
 * Numbers pop as they change; stages with problems are outlined red (errors) or amber (warnings).
 */
export function FormatFlow({ stages, maxTeams, issues, className }: { stages: StageSpec[]; maxTeams: number; issues: FormatIssue[]; className?: string }) {
  const levelOf = (i: number) => (issues.some((x) => x.stage === i && x.level === "error") ? "error" : issues.some((x) => x.stage === i && x.level === "warning") ? "warning" : null);
  return (
    <div className={cn("overflow-x-auto pb-1 [scrollbar-width:thin]", className)} role="img" aria-label={describe(stages, maxTeams)}>
      <ol className="flex min-w-max flex-col items-stretch gap-0 sm:flex-row sm:items-center">
        <Node icon={ClipboardList} title="Registration" big={maxTeams} sub="team slots" index={0} />
        {stages.map((s, i) => {
          const last = i === stages.length - 1;
          const out = teamsOut(s, last);
          const arrive = i === 0 ? maxTeams : teamsOut(stages[i - 1]!, false);
          return (
            <Fragment key={i}>
              <Arrow
                index={i}
                top={i === 0 ? "all teams" : arrowLabel(stages[i - 1]!)}
                count={arrive}
                extra={s.invitedSlots > 0 ? `+${s.invitedSlots} invited` : undefined}
              />
              <Node
                icon={last ? Crown : i === 0 ? Swords : Shield}
                title={s.name || `Stage ${i + 1}`}
                big={s.teamsIn}
                sub={s.groupCount > 1 ? `${s.groupCount} groups × ${s.lobbySize}` : `1 lobby`}
                foot={`${s.matchesPerGroup} ${s.matchesPerGroup === 1 ? "match" : "matches"}${!last && out ? ` · ${out} go through` : ""}`}
                level={levelOf(i)}
                index={i + 1}
              />
            </Fragment>
          );
        })}
        <Arrow index={stages.length} top="winner" count={1} />
        <Node icon={Trophy} title="Champion" big={1} sub="lifts the trophy" trophy index={stages.length + 1} />
      </ol>
    </div>
  );
}

function arrowLabel(s: StageSpec) {
  const wc = s.wildcardCount > 0 ? ` + ${s.wildcardCount} WC` : "";
  return s.groupCount > 1 ? `top ${s.advancePerGroup}/group${wc}` : `top ${s.advancePerGroup}${wc}`;
}

function describe(stages: StageSpec[], maxTeams: number) {
  return `${maxTeams} teams register, then ${stages.map((s) => `${s.name} with ${s.teamsIn} teams in ${s.groupCount} group${s.groupCount === 1 ? "" : "s"}`).join(", then ")}, then one champion.`;
}

function Node({ icon: Icon, title, big, sub, foot, level, trophy, index }: {
  icon: LucideIcon;
  title: string;
  big: number | string;
  sub: string;
  foot?: string;
  level?: "error" | "warning" | null;
  trophy?: boolean;
  index: number;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: EASE }}
      className={cn(
        "relative flex items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 shadow-sm sm:w-36 sm:flex-col sm:gap-1.5 sm:px-3 sm:text-center",
        trophy && "border-warning/50 bg-warning/10",
        level === "error" && "border-destructive/60 ring-2 ring-destructive/20",
        level === "warning" && "border-warning/60 ring-2 ring-warning/20",
      )}
    >
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          trophy ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 sm:flex-none">
        <span className="block truncate font-display text-base leading-tight font-bold">{title}</span>
        <span className="block font-display text-2xl leading-tight font-bold">
          {typeof big === "number" ? <AnimatedNumber value={big} /> : big}
        </span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{sub}</span>
        {foot && <span className="block text-[11px] leading-snug text-muted-foreground">{foot}</span>}
      </span>
    </motion.li>
  );
}

function Arrow({ top, count, extra, index }: { top: string; count: number; extra?: string; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.li layout aria-hidden className="relative flex items-center justify-center py-1.5 sm:min-w-28 sm:flex-col sm:px-1 sm:py-0">
      <span className="flex items-center gap-2 sm:flex-col sm:gap-0.5">
        <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{top}</span>
        <span className="relative flex items-center">
          <span className="hidden h-0.5 w-20 overflow-hidden rounded-full bg-border sm:block">
            {!reduce && (
              <motion.span
                className="block h-full w-6 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent"
                animate={{ x: [-24, 80] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: index * 0.2 }}
              />
            )}
          </span>
          <ArrowRight className="-ml-1.5 hidden size-4 text-primary sm:block" />
          <ArrowDown className="size-4 text-primary sm:hidden" />
        </span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-display text-sm font-bold text-primary">
          <AnimatedNumber value={count} /> {count === 1 ? "team" : "teams"}
        </span>
        {extra && <span className="text-[10px] font-semibold text-info">{extra}</span>}
      </span>
    </motion.li>
  );
}
