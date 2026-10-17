import { motion } from "framer-motion";
import { Crown, Shield, Swords, Trash2 } from "lucide-react";
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
export function StageEditor({ stage, index, isLast, issues, onChange, onRemove }: {
  stage: StageSpec;
  index: number;
  isLast: boolean;
  issues: FormatIssue[];
  onChange: (patch: Partial<StageSpec>) => void;
  onRemove?: () => void;
}) {
  const Icon = isLast ? Crown : index === 0 ? Swords : Shield;
  const sizes = groupSizes(stage.teamsIn, stage.groupCount);
  const smallest = Math.min(...sizes);
  const out = teamsOut(stage, isLast);
  const eliminated = stage.teamsIn - stage.groupCount * stage.advancePerGroup;
  const hasError = issues.some((i) => i.level === "error");
  const sizeText = sizes.length > 1 && Math.max(...sizes) !== smallest ? `${smallest}–${Math.max(...sizes)}` : String(smallest);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn("rounded-xl border bg-card p-4 shadow-sm sm:p-5", hasError && "border-destructive/50")}
    >
      <div className="flex items-start gap-3">
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
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Top teams per group go through" hint={`Out of ${smallest}+ in each group. ${stage.groupCount} × ${stage.advancePerGroup} = ${stage.groupCount * stage.advancePerGroup}.`}>
                <Stepper value={stage.advancePerGroup} onChange={(n) => onChange({ advancePerGroup: n })} min={0} max={Math.max(0, smallest - 1)} suffix="per group" />
              </Field>
              <Field label="Wildcards" hint="Best of the rest across all groups (by points per match) also go through.">
                <Stepper value={stage.wildcardCount} onChange={(n) => onChange({ wildcardCount: n })} min={0} max={Math.max(0, Math.min(128, eliminated))} suffix="teams" />
              </Field>
            </div>
          )}

          <Field label={`Matches in every group · ${stage.maps.length}`} hint="One map per match, in play order.">
            <MapsPicker value={stage.maps} onChange={(maps) => onChange({ maps, matchesPerGroup: maps.length })} />
          </Field>
        </div>
      </Advanced>
    </motion.div>
  );
}
