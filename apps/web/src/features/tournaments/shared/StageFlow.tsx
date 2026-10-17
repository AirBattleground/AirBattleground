import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Check, ChevronRight, ClipboardList, Crown, Lock, Shield, Swords, Trophy, X, type LucideIcon } from "lucide-react";
import type { StageStatus } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { cn } from "@7xen/ui/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";
import { fmtShortDay } from "./format";
import { LiveDot, STAGE_STATUS_LABELS } from "./StatusPill";

/** The subset of a stage the flow needs (StageSummary satisfies it). */
export interface StageFlowStage {
  id: string;
  order: number;
  name: string;
  status: StageStatus;
  teamsIn: number;
  teamsOut: number;
  groupCount: number;
  lobbySize: number;
  matchesPerGroup: number;
  advancePerGroup: number;
  wildcardCount: number;
  invitedSlots: number;
  startsAt?: string | null;
}

export type StageFlowYouState = "registered" | "waitlisted" | "playing" | "qualified" | "eliminated" | "champion";

export interface StageFlowYou {
  team: { name: string; tag: string };
  /** where the marker sits: a stage order, the registration node, or the trophy */
  at: number | "registration" | "champion";
  state: StageFlowYouState;
}

export interface StageFlowProps {
  stages: StageFlowStage[];
  /** adds a Registration node in front; omit to start at the first stage */
  registration?: { open: boolean; confirmed: number; max: number } | null;
  /** shown on the trophy node once known */
  champion?: { name: string; tag: string } | null;
  /** "YOU" marker with the team avatar */
  you?: StageFlowYou | null;
  /** outline a stage (e.g. the one being viewed) */
  selectedStageId?: string;
  /** makes stage nodes links */
  stageHref?: (stage: StageFlowStage) => string | undefined;
  /** "auto" = horizontal from md up, vertical timeline on phones */
  orientation?: "auto" | "horizontal" | "vertical";
  className?: string;
}

type NodeState = "done" | "current" | "upcoming";
interface FlowNode {
  key: string;
  kind: "registration" | "stage" | "trophy";
  icon: LucideIcon;
  title: string;
  state: NodeState;
  live?: boolean;
  stage?: StageFlowStage;
  /** small lines under the title */
  lines: ReactNode[];
  badge?: ReactNode;
  youHere?: StageFlowYou;
  href?: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/** Stage the tournament is "at" right now: live → drawn → next pending after the last completed. */
export function currentStageOrder(stages: StageFlowStage[]): number | null {
  const live = stages.find((s) => s.status === "LIVE") ?? stages.find((s) => s.status === "DRAWN");
  if (live) return live.order;
  const pending = stages.find((s) => s.status === "PENDING");
  return pending ? pending.order : null;
}

function advanceText(s: StageFlowStage) {
  if (s.advancePerGroup <= 0) return null;
  const wc = s.wildcardCount > 0 ? ` + ${s.wildcardCount} WC` : "";
  return s.groupCount > 1 ? `Top ${s.advancePerGroup}/group${wc}` : `Top ${s.advancePerGroup}${wc}`;
}

function buildNodes(p: StageFlowProps): { nodes: FlowNode[]; links: { label: string | null; state: NodeState }[] } {
  const stages = [...p.stages].sort((a, b) => a.order - b.order);
  const allDone = stages.length > 0 && stages.every((s) => s.status === "COMPLETED");
  const regOpen = !!p.registration?.open;
  const cur = regOpen || allDone ? null : currentStageOrder(stages);
  const nodes: FlowNode[] = [];

  if (p.registration) {
    const r = p.registration;
    nodes.push({
      key: "registration",
      kind: "registration",
      icon: regOpen ? ClipboardList : Lock,
      title: "Registration",
      state: regOpen ? "current" : "done",
      lines: [
        <span key="c" className="font-display text-base font-bold text-foreground tabular-nums">
          {r.confirmed}
          <span className="text-muted-foreground">/{r.max}</span>
        </span>,
        regOpen ? "Open now" : "Closed",
      ],
      youHere: p.you?.at === "registration" ? p.you : undefined,
    });
  }

  stages.forEach((s, i) => {
    const last = i === stages.length - 1;
    const state: NodeState = s.status === "COMPLETED" ? "done" : s.order === cur ? "current" : "upcoming";
    const groups = s.groupCount > 1 ? `${s.groupCount} groups × ${s.lobbySize}` : "1 lobby";
    nodes.push({
      key: s.id,
      kind: "stage",
      icon: last ? Crown : i === 0 ? Swords : Shield,
      title: s.name,
      state,
      live: s.status === "LIVE",
      stage: s,
      lines: [`${s.teamsIn} teams · ${groups}`, `${s.matchesPerGroup} ${s.matchesPerGroup === 1 ? "match" : "matches"}${s.startsAt ? ` · ${fmtShortDay(s.startsAt)}` : ""}`],
      badge: (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold tracking-wider uppercase",
            s.status === "LIVE" && "bg-destructive/10 text-destructive",
            s.status === "COMPLETED" && "bg-success/10 text-success",
            s.status === "DRAWN" && "bg-info/10 text-info",
            s.status === "PENDING" && "bg-muted text-muted-foreground",
          )}
        >
          {s.status === "LIVE" && <LiveDot className="size-1.5 [&>span]:size-1.5" />}
          {STAGE_STATUS_LABELS[s.status]}
        </span>
      ),
      youHere: p.you?.at === s.order ? p.you : undefined,
      href: p.stageHref?.(s),
    });
  });

  nodes.push({
    key: "trophy",
    kind: "trophy",
    icon: Trophy,
    title: "Champion",
    state: allDone || p.champion ? "done" : "upcoming",
    lines: [p.champion ? <span key="c" className="font-semibold text-foreground">{p.champion.name}</span> : "1 team lifts the trophy"],
    youHere: p.you?.at === "champion" ? p.you : undefined,
  });

  const links = nodes.slice(1).map((n, i) => {
    const from = nodes[i]!;
    const label =
      from.kind === "registration" ? (n.stage ? `${n.stage.teamsIn} slots` : null) : from.stage ? advanceText(from.stage) ?? (n.kind === "trophy" ? "Winner" : null) : null;
    const state: NodeState = from.state === "done" && n.state !== "upcoming" ? "done" : from.state === "done" ? "current" : "upcoming";
    return { label, state };
  });
  return { nodes, links };
}

// ---------------------------------------------------------------------------

const STATE_RING: Record<NodeState, string> = {
  done: "border-success/50 bg-success/15 text-success",
  current: "border-primary bg-primary text-primary-foreground shadow-glow",
  upcoming: "border-dashed border-border bg-card text-muted-foreground",
};

function NodeCircle({ node, size }: { node: FlowNode; size: "md" | "sm" }) {
  const reduce = useReducedMotion();
  const Icon = node.icon;
  const trophyDone = node.kind === "trophy" && node.state === "done";
  return (
    <span className={cn("relative flex shrink-0 items-center justify-center", size === "md" ? "size-14" : "size-11")}>
      {node.state === "current" && !reduce && (
        <>
          {[0, 1].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-primary"
              initial={{ scale: 1, opacity: 0.55 }}
              animate={{ scale: 1.75, opacity: 0 }}
              transition={{ duration: 2, repeat: Infinity, delay: i, ease: "easeOut" }}
            />
          ))}
        </>
      )}
      <span
        className={cn(
          "relative flex size-full items-center justify-center rounded-full border-2 transition-colors",
          trophyDone ? "border-warning/60 bg-warning/20 text-warning-foreground shadow-[0_0_22px_-4px_var(--warning)] dark:text-warning" : STATE_RING[node.state],
        )}
      >
        <Icon className={size === "md" ? "size-6" : "size-5"} strokeWidth={2.2} />
        {node.state === "done" && node.kind !== "trophy" && (
          <span className="absolute -right-0.5 -bottom-0.5 flex size-4.5 items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-card">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
    </span>
  );
}

const YOU_TONE: Record<StageFlowYouState, string> = {
  registered: "bg-primary text-primary-foreground",
  waitlisted: "bg-warning text-warning-foreground",
  playing: "bg-primary text-primary-foreground",
  qualified: "bg-success text-success-foreground",
  eliminated: "bg-muted-foreground text-background",
  champion: "bg-warning text-warning-foreground",
};

function YouMarker({ you, orientation }: { you: StageFlowYou; orientation: "horizontal" | "vertical" }) {
  const reduce = useReducedMotion();
  const out = you.state === "eliminated";
  return (
    <motion.span
      className={cn("pointer-events-none z-10 flex items-center", orientation === "horizontal" ? "flex-col gap-0.5" : "flex-row-reverse gap-1.5")}
      initial={{ opacity: 0, y: -8, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.6, type: "spring", stiffness: 380, damping: 20 }}
      aria-hidden
    >
      <span className={cn("rounded-full px-1.5 py-px text-[9px] font-black tracking-[0.18em]", YOU_TONE[you.state])}>{out ? "OUT" : "YOU"}</span>
      <motion.span
        className="relative"
        animate={reduce || out ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <TeamAvatar name={you.team.name} tag={you.team.tag} size="sm" className={cn("size-7 rounded-lg text-[9px] ring-2 ring-card", out && "grayscale opacity-70")} />
        {out && (
          <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-destructive text-white ring-2 ring-card">
            <X className="size-2.5" strokeWidth={3} />
          </span>
        )}
      </motion.span>
    </motion.span>
  );
}

function youSr(you: StageFlowYou) {
  return { registered: "Your team is registered", waitlisted: "Your team is on the waiting list", playing: "Your team is here", qualified: "Your team qualified from here", eliminated: "Your team was eliminated here", champion: "Your team is the champion" }[you.state];
}

function NodeShell({ node, className, children }: { node: FlowNode; className?: string; children: ReactNode }) {
  const label = `${node.title}${node.stage ? ` — ${STAGE_STATUS_LABELS[node.stage.status]}` : ""}${node.youHere ? `. ${youSr(node.youHere)}` : ""}`;
  if (node.href)
    return (
      <Link
        to={node.href}
        aria-label={`${label}. Open stage`}
        aria-current={node.state === "current" ? "step" : undefined}
        className={cn("group/node rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
      >
        {children}
      </Link>
    );
  return (
    <div aria-label={label} aria-current={node.state === "current" ? "step" : undefined} className={className}>
      {children}
    </div>
  );
}

function Connector({ state, label, orientation, index }: { state: NodeState; label: string | null; orientation: "horizontal" | "vertical"; index: number }) {
  const reduce = useReducedMotion();
  const h = orientation === "horizontal";
  return (
    <div className={cn("relative", h ? cn("mt-[27px] h-0.5 flex-1", label ? "min-w-40" : "min-w-20") : "ml-[21px] w-0.5 flex-1 min-h-6")} aria-hidden>
      <div className={cn("absolute inset-0 rounded-full", state === "upcoming" ? (h ? "border-t-2 border-dashed border-border" : "border-l-2 border-dashed border-border") : "bg-border")} />
      {state !== "upcoming" && (
        <motion.div
          className={cn("absolute inset-0 rounded-full", state === "done" ? "bg-success/70" : "bg-gradient-to-r from-success/70 to-primary")}
          style={{ transformOrigin: h ? "left center" : "center top" }}
          initial={h ? { scaleX: 0 } : { scaleY: 0 }}
          animate={h ? { scaleX: 1 } : { scaleY: 1 }}
          transition={{ duration: 0.5, delay: 0.25 + index * 0.12, ease: EASE }}
        />
      )}
      {state === "current" && !reduce && (
        <motion.span
          className={cn("absolute size-2 rounded-full bg-primary shadow-glow", h ? "-top-[3px]" : "-left-[3px]")}
          initial={h ? { left: "0%" } : { top: "0%" }}
          animate={h ? { left: ["0%", "100%"] } : { top: ["0%", "100%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
      )}
      {label && h && (
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-sm">
          {label}
        </span>
      )}
    </div>
  );
}

function Horizontal({ nodes, links, selectedStageId }: { nodes: FlowNode[]; links: { label: string | null; state: NodeState }[]; selectedStageId?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  // when the chart overflows, bring the YOU marker (or the current stage) into view
  useEffect(() => {
    const c = scroller.current;
    if (!c || c.scrollWidth <= c.clientWidth) return;
    const el = c.querySelector<HTMLElement>("[data-you]") ?? c.querySelector<HTMLElement>('[aria-current="step"]');
    const li = el?.closest("li");
    if (li) c.scrollLeft = li.offsetLeft - c.clientWidth / 2 + li.clientWidth / 2;
  }, [nodes.length]);
  return (
    <div ref={scroller} className="overflow-x-auto pb-1 [scrollbar-width:thin]">
      <ol className="flex min-w-max items-start px-1 pt-14">
        {nodes.map((n, i) => (
          <Fragment key={n.key}>
            {i > 0 && (
              <li className="relative z-0 -mx-7 flex flex-1 self-stretch xl:-mx-10" aria-hidden>
                <Connector state={links[i - 1]!.state} label={links[i - 1]!.label} orientation="horizontal" index={i} />
              </li>
            )}
            <motion.li
              className="relative z-10 w-28 shrink-0 xl:w-36"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.08, ease: EASE }}
            >
              {n.youHere && (
                <span data-you className="absolute -top-14 left-1/2 -translate-x-1/2">
                  <YouMarker you={n.youHere} orientation="horizontal" />
                </span>
              )}
              <NodeShell node={n} className="flex flex-col items-center text-center">
                <span className="transition-transform duration-200 group-hover/node:-translate-y-0.5">
                  <NodeCircle node={n} size="md" />
                </span>
                <span
                  className={cn(
                    "mt-2.5 flex w-full flex-col items-center gap-0.5 rounded-xl px-1.5 py-1.5 transition-colors",
                    n.href && "group-hover/node:bg-accent/50",
                    n.stage && n.stage.id === selectedStageId && "bg-primary/10 ring-1 ring-primary/40",
                  )}
                >
                  <span className={cn("flex items-center gap-0.5 font-display text-base leading-tight font-bold", n.state === "upcoming" && "text-muted-foreground")}>
                    {n.title}
                    {n.href && <ChevronRight className="size-3.5 opacity-0 transition-opacity group-hover/node:opacity-60" />}
                  </span>
                  {n.badge}
                  {n.lines.map((l, j) => (
                    <span key={j} className="text-[11px] leading-snug text-muted-foreground">
                      {l}
                    </span>
                  ))}
                </span>
              </NodeShell>
            </motion.li>
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

function Vertical({ nodes, links, selectedStageId }: { nodes: FlowNode[]; links: { label: string | null; state: NodeState }[]; selectedStageId?: string }) {
  return (
    <ol className="flex flex-col">
      {nodes.map((n, i) => {
        const link = links[i];
        return (
          <motion.li
            key={n.key}
            className="flex gap-3"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.07, ease: EASE }}
          >
            <div className="flex flex-col">
              <NodeCircle node={n} size="sm" />
              {link && <Connector state={link.state} label={null} orientation="vertical" index={i + 1} />}
            </div>
            <div className={cn("min-w-0 flex-1", link ? "pb-4" : "pb-0")}>
              <NodeShell
                node={n}
                className={cn(
                  "flex items-start gap-2 rounded-xl border px-3 py-2 transition-colors",
                  n.state === "current" ? "border-primary/40 bg-primary/5" : "border-transparent",
                  n.href && "hover:border-border hover:bg-accent/40",
                  n.stage && n.stage.id === selectedStageId && "border-primary/50 bg-primary/10",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={cn("font-display text-base leading-tight font-bold", n.state === "upcoming" && "text-muted-foreground")}>{n.title}</span>
                    {n.badge}
                  </span>
                  {n.lines.map((l, j) => (
                    <span key={j} className="block text-xs leading-snug text-muted-foreground">
                      {l}
                    </span>
                  ))}
                </span>
                {n.youHere && <YouMarker you={n.youHere} orientation="vertical" />}
                {n.href && <ChevronRight className="mt-0.5 size-4 shrink-0 self-center text-muted-foreground" />}
              </NodeShell>
              {link?.label && (
                <span className="mt-1.5 ml-3 inline-flex items-center rounded-full border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {link.label} ↓
                </span>
              )}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

/**
 * Animated tournament flow chart: Registration → each stage → 🏆.
 * Current stage pulses, finished stages get a check, an optional YOU marker (team avatar) sits on a node.
 * Horizontal from md up; vertical timeline on phones (or force with `orientation`).
 */
export function StageFlow(props: StageFlowProps) {
  const isMd = useMediaQuery("(min-width: 768px)");
  const o = props.orientation === "horizontal" || props.orientation === "vertical" ? props.orientation : isMd ? "horizontal" : "vertical";
  const { nodes, links } = buildNodes(props);
  return (
    <nav aria-label="Tournament stages" className={cn("w-full", props.className)}>
      {o === "horizontal" ? <Horizontal nodes={nodes} links={links} selectedStageId={props.selectedStageId} /> : <Vertical nodes={nodes} links={links} selectedStageId={props.selectedStageId} />}
    </nav>
  );
}

export function StageFlowSkeleton() {
  return (
    <div className="flex items-start gap-3 overflow-hidden pt-14 max-md:flex-col max-md:pt-0">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-1 items-center gap-3 md:flex-col">
          <div className="size-12 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="w-28 space-y-1.5 md:mx-auto">
            <div className="h-4 w-20 animate-pulse rounded bg-muted md:mx-auto" />
            <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
