import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Plus, ShieldAlert, UserPlus, X } from "lucide-react";
import { MAX_ROSTER_PLAYERS, type MatchDetail, type MatchTeamRow, type SaveLineupInput, type TeamSummary } from "@7xen/shared";
import { TeamAvatar } from "@7xen/ui/components/brand/status";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { cn } from "@7xen/ui/lib/utils";
import { ConfirmDialog } from "@/features/manager/components/ConfirmDialog";
import { useSaveLineup } from "../api";
import { findSlotSource, ScreenshotCrop } from "./ScreenshotCrop";

export const LOW_CONFIDENCE = 0.85;
const pad = (n: number) => String(n).padStart(2, "0");
const isRegistrationFlag = (f: string) => /no (registered )?team|not registered|nobody registered/i.test(f);

export interface LineupDraft {
  /** `${slot}:${position}` → typed name */
  names: Record<string, string>;
  added: number[];
  removed: number[];
}
export const emptyLineupDraft = (): LineupDraft => ({ names: {}, added: [], removed: [] });
export const lineupDirty = (d: LineupDraft) => Object.keys(d.names).length > 0 || d.added.length > 0 || d.removed.length > 0;

interface Card {
  slot: number;
  team: TeamSummary | null;
  row: MatchTeamRow | null;
}

function buildCards(m: MatchDetail, draft: LineupDraft): { cards: Card[]; missing: { slotNumber: number; team: TeamSummary }[] } {
  const reg = new Map(m.sessionSlots.map((s) => [s.slotNumber, s.team]));
  const rows = new Map(m.teams.map((t) => [t.slotNumber, t]));
  // With nothing read yet, start from the registered teams so the lineup can be typed by hand.
  const base = m.teams.length > 0 ? m.teams.map((t) => t.slotNumber) : m.sessionSlots.map((s) => s.slotNumber);
  const slots = [...new Set([...base, ...draft.added])].filter((s) => !draft.removed.includes(s)).sort((a, b) => a - b);
  const cards = slots.map((slot) => ({ slot, team: rows.get(slot)?.team ?? reg.get(slot) ?? null, row: rows.get(slot) ?? null }));
  const inLineup = new Set(slots);
  const missing = m.sessionSlots.filter((s) => !inLineup.has(s.slotNumber));
  return { cards, missing };
}

/** The lineup the manager sees right now (server values overlaid with typed edits). */
export function lineupInput(m: MatchDetail, draft: LineupDraft, confirm: boolean): SaveLineupInput {
  const { cards } = buildCards(m, draft);
  return {
    confirm,
    teams: cards.map((c) => {
      const count = Math.max(4, c.row?.players.length ?? 0, ...positionsTyped(draft, c.slot));
      const players: SaveLineupInput["teams"][number]["players"] = [];
      for (let pos = 1; pos <= Math.min(count, MAX_ROSTER_PLAYERS); pos++) {
        const name = nameAt(c, draft, pos).trim();
        if (name) players.push({ position: pos, name: name.slice(0, 40) });
      }
      return { slotNumber: c.slot, players };
    }),
  };
}

function positionsTyped(d: LineupDraft, slot: number): number[] {
  return Object.keys(d.names)
    .filter((k) => k.startsWith(`${slot}:`))
    .map((k) => Number(k.split(":")[1]));
}

function nameAt(c: Card, d: LineupDraft, pos: number): string {
  const typed = d.names[`${c.slot}:${pos}`];
  if (typed !== undefined) return typed;
  return c.row?.players.find((p) => p.position === pos)?.name ?? "";
}

export function LineupStep({
  m,
  draft,
  setDraft,
  readOnly,
  onOpenShot,
  onConfirmed,
}: {
  m: MatchDetail;
  draft: LineupDraft;
  setDraft: (fn: (d: LineupDraft) => LineupDraft) => void;
  readOnly: boolean;
  onOpenShot: (screenshotId: string) => void;
  onConfirmed: () => void;
}) {
  const save = useSaveLineup(m.match.id);
  const [confirming, setConfirming] = useState(false);
  const [addSlot, setAddSlot] = useState<string>("");
  const { cards, missing } = useMemo(() => buildCards(m, draft), [m, draft]);
  const confirmed = m.match.status !== "SCHEDULED" && m.match.status !== "LINEUP_REVIEW";
  const dirty = lineupDirty(draft);

  const lowConf = cards.reduce(
    (n, c) => n + (c.row?.players.filter((p) => p.ocrConfidence != null && p.ocrConfidence < LOW_CONFIDENCE && draft.names[`${c.slot}:${p.position}`] === undefined).length ?? 0),
    0,
  );
  const unregistered = cards.filter((c) => !c.team).length;
  const empty = useMemo(() => lineupInput(m, draft, false).teams.filter((t) => t.players.length === 0).length, [m, draft]);

  const allSlots = Array.from({ length: 25 }, (_, i) => i + 1).filter((s) => !cards.some((c) => c.slot === s));

  const doSave = (confirm: boolean) =>
    save.mutate(lineupInput(m, draft, confirm), {
      onSuccess: () => {
        setDraft(emptyLineupDraft);
        if (confirm && !confirmed) onConfirmed();
      },
    });

  return (
    <div className="space-y-4">
      {/* summary */}
      <div data-tour="lineup-summary" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 text-sm shadow-sm">
        <span className="font-display text-2xl font-bold">{cards.length}</span>
        <span className="mr-2 text-muted-foreground">team{cards.length === 1 ? "" : "s"} in this match</span>
        {lowConf > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning-foreground dark:text-warning">
            <AlertTriangle className="size-3.5" /> {lowConf} name{lowConf === 1 ? "" : "s"} to double-check
          </span>
        )}
        {unregistered > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
            <ShieldAlert className="size-3.5" /> {unregistered} slot{unregistered === 1 ? "" : "s"} without a registered team
          </span>
        )}
        {empty > 0 && <span className="text-xs text-muted-foreground">· {empty} without player names</span>}
        {lowConf === 0 && unregistered === 0 && empty === 0 && cards.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle2 className="size-3.5" /> Looks good
          </span>
        )}
      </div>

      {m.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {m.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" /> {w}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && missing.length > 0 && (
        <div className="rounded-xl border border-dashed p-3">
          <p className="mb-2 text-sm">
            <span className="font-semibold">Registered but not in this lineup.</span>{" "}
            <span className="text-muted-foreground">Add them if they played.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {missing.map((s) => (
              <Button
                key={s.slotNumber}
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft((d) => ({ ...d, added: [...d.added, s.slotNumber], removed: d.removed.filter((x) => x !== s.slotNumber) }))
                }
              >
                <Plus /> <span className="font-display">#{pad(s.slotNumber)}</span> {s.team.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No teams yet. Upload the team list screenshots above, or add a slot by hand below.
        </div>
      ) : (
        <ul data-tour="lineup-grid" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {cards.map((c) => (
            <SlotCard
              key={c.slot}
              card={c}
              draft={draft}
              setDraft={setDraft}
              readOnly={readOnly}
              m={m}
              onOpenShot={onOpenShot}
            />
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={addSlot} onValueChange={setAddSlot}>
            <SelectTrigger className="w-44" aria-label="Slot to add">
              <SelectValue placeholder="Add a slot by hand" />
            </SelectTrigger>
            <SelectContent>
              {allSlots.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  Slot #{pad(s)}
                  {m.sessionSlots.find((x) => x.slotNumber === s) ? ` · ${m.sessionSlots.find((x) => x.slotNumber === s)?.team.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!addSlot}
            onClick={() => {
              const n = Number(addSlot);
              setDraft((d) => ({ ...d, added: [...d.added, n], removed: d.removed.filter((x) => x !== n) }));
              setAddSlot("");
            }}
          >
            <UserPlus /> Add slot
          </Button>
        </div>
      )}

      {!readOnly && (
        <div
          data-tour="lineup-confirm"
          className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/95 p-3 shadow-lg backdrop-blur"
        >
          <p className="text-sm text-muted-foreground">
            {confirmed
              ? dirty
                ? "You have unsaved changes to the lineup."
                : "Lineup confirmed. You can still fix names here."
              : "Check every name, then confirm. Confirmed names help read the results automatically."}
          </p>
          <div className="flex gap-2">
            {!confirmed && (
              <Button variant="outline" disabled={save.isPending || !dirty} onClick={() => doSave(false)}>
                Save draft
              </Button>
            )}
            {confirmed ? (
              <Button disabled={save.isPending || !dirty} onClick={() => doSave(true)}>
                {save.isPending ? "Saving…" : "Save lineup changes"}
              </Button>
            ) : (
              <Button size="lg" className="shadow-glow" disabled={save.isPending || cards.length === 0} onClick={() => setConfirming(true)}>
                <CheckCircle2 /> {save.isPending ? "Saving…" : "Confirm lineup"}
              </Button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Confirm ${cards.length} team${cards.length === 1 ? "" : "s"}?`}
        description={
          unregistered > 0
            ? `${unregistered} slot${unregistered === 1 ? " has" : "s have"} no registered team — they won't appear on the points table. The match moves to “In progress”; you can still fix names later.`
            : "The match moves to “In progress”. When it ends, upload the final results screenshots. You can still fix names later."
        }
        confirmLabel="Confirm lineup"
        onConfirm={() => doSave(true)}
      />
    </div>
  );
}

function SlotCard({
  card: c,
  draft,
  setDraft,
  readOnly,
  m,
  onOpenShot,
}: {
  card: Card;
  draft: LineupDraft;
  setDraft: (fn: (d: LineupDraft) => LineupDraft) => void;
  readOnly: boolean;
  m: MatchDetail;
  onOpenShot: (id: string) => void;
}) {
  const source = findSlotSource(m.screenshots, c.slot);
  const count = Math.min(MAX_ROSTER_PLAYERS, Math.max(4, c.row?.players.length ?? 0, ...positionsTyped(draft, c.slot)));
  const flags = (c.row?.flags ?? []).filter((f) => !isRegistrationFlag(f));

  return (
    <li className={cn("flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm", !c.team && "border-destructive/40")}>
      <div className="flex items-center gap-3 border-b bg-gradient-to-r from-primary/10 to-transparent p-3">
        <span className="grid min-w-14 place-items-center rounded-xl border border-primary/40 bg-primary/10 px-2 py-1 font-display text-3xl font-bold leading-none">
          <span className="text-[9px] font-semibold tracking-[0.25em] text-primary">SLOT</span>
          {pad(c.slot)}
        </span>
        {c.team ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <TeamAvatar name={c.team.name} tag={c.team.tag} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{c.team.name}</p>
              <p className="text-xs text-muted-foreground">[{c.team.tag}]</p>
            </div>
          </div>
        ) : (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-destructive">
            <ShieldAlert className="size-4 shrink-0" /> No team registered on this slot
          </p>
        )}
        {!readOnly && (
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove slot ${c.slot} from this match`}
            title="Didn't play — remove from this match"
            onClick={() =>
              setDraft((d) => ({ ...d, removed: [...d.removed, c.slot], added: d.added.filter((x) => x !== c.slot) }))
            }
          >
            <X />
          </Button>
        )}
      </div>
      <div className="grid flex-1 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]">
        <div className="space-y-2">
          {Array.from({ length: count }, (_, i) => i + 1).map((pos) => {
            const key = `${c.slot}:${pos}`;
            const server = c.row?.players.find((p) => p.position === pos);
            const value = nameAt(c, draft, pos);
            const touched = draft.names[key] !== undefined;
            const low = !touched && server?.ocrConfidence != null && server.ocrConfidence < LOW_CONFIDENCE;
            const differs = server?.ocrName && server.ocrName !== value;
            return (
              <div key={pos}>
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-display text-xs font-bold text-muted-foreground">P{pos}</span>
                  <Input
                    value={value}
                    disabled={readOnly}
                    placeholder={pos > 4 ? "Substitute (optional)" : "Player name"}
                    aria-label={`Slot ${c.slot} player ${pos}`}
                    maxLength={40}
                    onChange={(e) => setDraft((d) => ({ ...d, names: { ...d.names, [key]: e.target.value } }))}
                    className={cn("h-9 pl-9 font-medium", low && "border-warning bg-warning/10 focus-visible:ring-warning/40")}
                  />
                </div>
                {(low || (differs && !touched)) && server?.ocrName && (
                  <p className={cn("mt-0.5 pl-1 text-[11px]", low ? "text-warning-foreground dark:text-warning" : "text-muted-foreground")}>
                    Read as “{server.ocrName}”
                    {server.ocrConfidence != null && ` · ${Math.round(server.ocrConfidence * 100)}% sure`}
                    {differs && !low && " · matched to a known name"}
                  </p>
                )}
              </div>
            );
          })}
          {!readOnly && count < MAX_ROSTER_PLAYERS && (
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setDraft((d) => ({ ...d, names: { ...d.names, [`${c.slot}:${count + 1}`]: "" } }))}
            >
              <Plus /> Add a player
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {source ? (
            <ScreenshotCrop source={source} onClick={() => onOpenShot(source.shot.id)} />
          ) : (
            <div className="grid aspect-[2/1] place-items-center rounded-lg border border-dashed p-2 text-center text-[11px] text-muted-foreground">
              Typed by hand
            </div>
          )}
          {flags.length > 0 && (
            <ul className="space-y-1">
              {flags.map((f, i) => (
                <li key={i} className="flex items-start gap-1 text-[11px] text-warning-foreground dark:text-warning">
                  <AlertTriangle className="mt-px size-3 shrink-0" /> {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
