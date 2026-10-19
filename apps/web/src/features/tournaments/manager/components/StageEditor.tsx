import { motion, type DragControls } from "framer-motion";
import { ArrowDown, ArrowUp, Crown, GripVertical, Shield, Swords, Trash2 } from "lucide-react";
import type { FormatIssue, StageSpec } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { cn } from "@7xen/ui/lib/utils";
import { MapChips } from "@/features/manager/components/maps";
import { MapsPicker } from "@/features/manager/components/MapsPicker";
import { Stepper } from "@/features/manager/components/Stepper";
import { groupSizes, teamsOut } from "../engine";
import { Advanced, Field } from "./form";
import { FormatIssues } from "./FormatIssues";

/** One stage of the format: a plain summary up top, every knob inside a collapsed "Advanced" panel. */
export function StageEditor({ stage, index, isLast, issues, onChange, onRemove, dragControls, onMove, canMoveUp, canMoveDown }: {
  stage: StageSpec;
  index: number;
  isLast: boolean;
  issues: FormatIssue[];
  onChange: (patch: Partial<StageSpec>) => void;
  onRemove?: () => void;
  /** when set, a drag handle is shown (the parent is a framer-motion Reorder.Item with dragListener off) */
  dragControls?: DragControls;
  onMove?: (dir: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const Icon = isLast ? Crown : index === 0 ? Swords : Shield;
  const sizes = groupSizes(stage.teamsIn, stage.groupCount);
  const smallest = Math.min(...sizes);
  const out = teamsOut(stage, isLast);
  const hasError = issues.some((i) => i.level === "error");
  const sizeText = sizes.length > 1 && Math.max(...sizes) !== smallest ? `${smallest}–${Math.max(...sizes)}` : String(smallest);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", hasError && "border-destructive/50")}
    >
      <div className="flex items-start gap-3">
        {dragControls && (
          <span className="-ml-2 flex shrink-0 flex-col items-center">
            <button
              type="button"
              onPointerDown={(e) => dragControls.start(e)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && canMoveUp) { e.preventDefault(); onMove?.(-1); }
                if (e.key === "ArrowDown" && canMoveDown) { e.preventDefault(); onMove?.(1); }
              }}
              className="flex size-8 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
              aria-label={`Drag to reorder ${stage.name}. Or press the up and down arrow keys.`}
              title="Drag to reorder"
            >
              <GripVertical className="size-4" />
            </button>
            <span className="flex sm:hidden">
              <button type="button" disabled={!canMoveUp} onClick={() => onMove?.(-1)} aria-label={`Move ${stage.name} up`} className="flex size-6 items-center justify-center rounded text-muted-foreground disabled:opacity-30">
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" disabled={!canMoveDown} onClick={() => onMove?.(1)} aria-label={`Move ${stage.name} down`} className="flex size-6 items-center justify-center rounded text-muted-foreground disabled:opacity-30">
                <ArrowDown className="size-3.5" />
              </button>
            </span>
          </span>
        )}
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
          <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-primary font-display text-[11px] font-bold text-primary-foreground">
            {index + 1}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl leading-tight font-bold">{stage.name || `Stage ${index + 1}`}</p>
          <p className="text-sm text-muted-foreground">
            {stage.teamsIn} teams · {stage.groupCount > 1 ? `${stage.groupCount} groups of ${sizeText}` : `one lobby of ${sizeText}`} · {stage.matchesPerGroup}{" "}
            {stage.matchesPerGroup === 1 ? "match" : "matches"}
            {isLast ? " · decides the champion" : ` · ${out} go through`}
          </p>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${stage.name}`} onClick={onRemove} className="text-muted-foreground hover:text-destructive">
            <Trash2 />
          </Button>
        )}
      </div>

      <MapChips maps={stage.maps} numbered className="mt-3" />
      {issues.length > 0 && <FormatIssues issues={issues} okText={null} className="mt-3" />}

      <Advanced className="mt-4" title={`Change ${stage.name || "this stage"}`} hint="Name, lobbies, maps, who goes through">
        <div className="space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Stage name" htmlFor={`stage-${index}-name`}>
              <Input id={`stage-${index}-name`} value={stage.name} maxLength={40} onChange={(e) => onChange({ name: e.target.value })} className="h-10" />
            </Field>
            <Field label="Teams per lobby (max)" hint="BGMI rooms hold up to 25 teams.">
              <Stepper value={stage.lobbySize} onChange={(n) => onChange({ lobbySize: n, groupCount: Math.ceil(stage.teamsIn / n) })} min={2} max={25} suffix="teams" />
            </Field>
            <Field label="Number of groups" hint={`Each group plays in its own lobby. ${stage.teamsIn} teams → groups of ${sizeText}.`}>
              <Stepper
                value={stage.groupCount}
                onChange={(n) => onChange({ groupCount: n })}
                min={Math.max(1, Math.ceil(stage.teamsIn / stage.lobbySize))}
                max={Math.max(1, Math.floor(stage.teamsIn / 2))}
                suffix={stage.groupCount === 1 ? "group" : "groups"}
              />
            </Field>
            {index > 0 && (
              <Field label="Invited teams" hint="Teams you place straight into this stage (e.g. last season's top teams).">
                <Stepper value={stage.invitedSlots} onChange={(n) => onChange({ invitedSlots: n })} min={0} max={64} suffix="teams" />
              </Field>
            )}
          </div>

          {!isLast && (
            <Field label="Top teams per group go through" hint={`Out of ${smallest}+ in each group. ${stage.groupCount} × ${stage.advancePerGroup} = ${stage.groupCount * stage.advancePerGroup}.`}>
              <Stepper value={stage.advancePerGroup} onChange={(n) => onChange({ advancePerGroup: n })} min={0} max={Math.max(0, smallest - 1)} suffix="per group" />
            </Field>
          )}

          <Field label={`Matches in every group · ${stage.maps.length}`} hint="One map per match, in play order.">
            <MapsPicker value={stage.maps} onChange={(maps) => onChange({ maps, matchesPerGroup: maps.length })} />
          </Field>
        </div>
      </Advanced>
    </motion.div>
  );
}
