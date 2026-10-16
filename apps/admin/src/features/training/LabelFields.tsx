import { createContext, useContext, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Crown, Plus, RotateCcw, Trash2, UserPlus, X } from "lucide-react";
import { MAX_ROSTER_PLAYERS } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@7xen/ui/components/ui/tooltip";
import { cn } from "@7xen/ui/lib/utils";
import {
  CHAR_PALETTE,
  LOW_CONFIDENCE,
  MAX_NAME_LENGTH,
  classifyChar,
  codePoint,
  emptyPlayer,
  hasInvisible,
  needsNfc,
  type DraftErrors,
  type GroupDraft,
  type OcrHint,
  type PlayerDraft,
} from "./labels";

// ---------- "insert special character into the last focused name" ----------
interface InsertTarget {
  el: HTMLInputElement;
  apply: (value: string) => void;
}
const InsertCtx = createContext<{ current: InsertTarget | null } | null>(null);

export function InsertTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<InsertTarget | null>(null);
  return <InsertCtx.Provider value={ref}>{children}</InsertCtx.Provider>;
}
function useInsertTarget() {
  const ctx = useContext(InsertCtx);
  if (!ctx) throw new Error("InsertTargetProvider missing");
  return ctx;
}

export function CharPalette({ className }: { className?: string }) {
  const target = useInsertTarget();
  const insert = (ch: string) => {
    const t = target.current;
    if (!t || !t.el.isConnected) return;
    const v = t.el.value;
    const start = t.el.selectionStart ?? v.length;
    const end = t.el.selectionEnd ?? v.length;
    const next = (v.slice(0, start) + ch + v.slice(end)).slice(0, MAX_NAME_LENGTH);
    t.apply(next);
    requestAnimationFrame(() => {
      t.el.focus();
      const pos = Math.min(start + ch.length, next.length);
      t.el.setSelectionRange(pos, pos);
    });
  };
  return (
    <div className={cn("rounded-xl border bg-card p-3 shadow-sm", className)} data-tour="char-palette">
      <p className="mb-2 text-xs text-muted-foreground">Click a name box, then a character to insert it where the cursor is.</p>
      <div className="grid gap-2">
        {CHAR_PALETTE.map((group) => (
          <div key={group.label} className="grid gap-1">
            <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</div>
            <div className="flex flex-wrap gap-1">
              {group.chars.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  // keep focus + caret in the name box when clicked with a mouse
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(ch)}
                  title={`Insert ${ch} (${codePoint(ch)})`}
                  aria-label={`Insert ${ch}`}
                  className="flex h-7 min-w-7 items-center justify-center rounded-md border bg-background px-1 text-sm transition-colors outline-none hover:border-primary/50 hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {ch === "ㅤ" ? <span className="text-[10px] text-muted-foreground">blank</span> : ch}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- look-alike view ----------
const GLYPH_STYLE = {
  one: "bg-warning/25 text-foreground ring-1 ring-warning/60",
  zero: "bg-info/20 text-foreground ring-1 ring-info/60",
  space: "text-muted-foreground",
  invisible: "bg-destructive/15 text-destructive ring-1 ring-destructive/50",
  unicode: "bg-primary/10 text-foreground ring-1 ring-primary/40",
  plain: "",
} as const;
const GLYPH_TITLE = {
  one: "Looks like I / l / 1 / |",
  zero: "Looks like O / 0 / o",
  space: "Space",
  invisible: "Invisible character",
  unicode: "Special character",
  plain: "",
} as const;

export function GlyphView({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-px font-mono text-sm leading-6" aria-label={`Characters: ${[...text].map((c) => `${c} ${codePoint(c)}`).join(", ")}`}>
      {[...text].map((ch, i) => {
        const c = classifyChar(ch);
        return (
          <span key={i} title={`${GLYPH_TITLE[c] ? `${GLYPH_TITLE[c]} · ` : ""}${codePoint(ch)}`} className={cn("inline-flex min-w-[1ch] justify-center rounded-[3px] px-[1px]", GLYPH_STYLE[c])}>
            {c === "space" ? "␣" : c === "invisible" ? `⟨${codePoint(ch).slice(2)}⟩` : ch}
          </span>
        );
      })}
    </div>
  );
}

export function GlyphLegend() {
  const items: [keyof typeof GLYPH_STYLE, string, string][] = [
    ["one", "I", "I · l · 1 · |"],
    ["zero", "0", "O · 0 · o"],
    ["unicode", "多", "special"],
    ["invisible", "⟨200B⟩", "invisible"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map(([k, sample, label]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className={cn("rounded-[3px] px-1 font-mono", GLYPH_STYLE[k])}>{sample}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------- confidence ----------
export function ConfidenceBadge({ hint, className }: { hint: OcrHint | undefined; className?: string }) {
  if (!hint) return null;
  const low = hint.confidence < LOW_CONFIDENCE;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            low ? "bg-warning/20 text-warning-foreground dark:text-warning" : "bg-success/10 text-success",
            className,
          )}
        >
          {Math.round(hint.confidence * 100)}%
        </span>
      </TooltipTrigger>
      <TooltipContent>{low ? "The model wasn't sure — please double-check" : "How sure the model was"}</TooltipContent>
    </Tooltip>
  );
}

/** "Model read: X" under a field when the value differs from what OCR read. */
function OcrNote({ hint, value, onRestore }: { hint: OcrHint | undefined; value: string; onRestore: () => void }) {
  if (!hint) return null;
  if (hint.text === value) return hint.confidence < LOW_CONFIDENCE ? <p className="mt-1 text-[11px] text-warning-foreground dark:text-warning">Model wasn't sure — check against the screenshot</p> : null;
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="shrink-0">Model read:</span>
      <span className="truncate font-mono text-foreground/80 line-through decoration-destructive/60">{hint.text || "(nothing)"}</span>
      {hint.text && (
        <button type="button" onClick={onRestore} className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={`Use what the model read: ${hint.text}`}>
          <RotateCcw className="size-3" /> use
        </button>
      )}
    </p>
  );
}

// ---------- name / number inputs ----------
function NameField({
  player,
  index,
  onChange,
  showGlyphs,
  error,
  autoFocus,
}: {
  player: PlayerDraft;
  index: number;
  onChange: (p: PlayerDraft) => void;
  showGlyphs: boolean;
  error?: string;
  autoFocus?: boolean;
}) {
  const target = useInsertTarget();
  const ref = useRef<HTMLInputElement>(null);
  const low = !!player.nameOcr && player.nameOcr.confidence < LOW_CONFIDENCE && player.nameOcr.text === player.name;
  const invisible = hasInvisible(player.name);
  const nfc = needsNfc(player.name);
  return (
    <div className="min-w-0 flex-1">
      <div className="relative">
        <Input
          ref={ref}
          value={player.name}
          maxLength={MAX_NAME_LENGTH}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          lang="und"
          dir="auto"
          placeholder={`Player ${index + 1}`}
          aria-label={`Player ${index + 1} name`}
          aria-invalid={!!error || undefined}
          onFocus={(e) => (target.current = { el: e.currentTarget, apply: (v) => onChange({ ...player, name: v }) })}
          onChange={(e) => onChange({ ...player, name: e.target.value })}
          className={cn("h-9 pr-12", showGlyphs && "font-mono", low && "border-warning/70 bg-warning/5 focus-visible:border-warning")}
        />
        <ConfidenceBadge hint={player.nameOcr} className="absolute top-1/2 right-2 -translate-y-1/2" />
      </div>
      {error && <p className="mt-1 text-xs font-medium text-destructive">{error}</p>}
      {(invisible || nfc) && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-warning-foreground dark:text-warning">
          <AlertTriangle className="size-3 shrink-0" />
          {invisible ? "Has extra or invisible spaces" : "Accents are stored oddly"}
          <button
            type="button"
            className="ml-1 font-semibold text-primary hover:underline"
            onClick={() =>
              onChange({
                ...player,
                name: [...player.name.normalize("NFC")]
                  .filter((c) => classifyChar(c) !== "invisible")
                  .join("")
                  .replace(/ {2,}/g, " ")
                  .trim(),
              })
            }
          >
            Fix
          </button>
        </p>
      )}
      <OcrNote hint={player.nameOcr} value={player.name} onRestore={() => onChange({ ...player, name: player.nameOcr!.text.slice(0, MAX_NAME_LENGTH) })} />
      {showGlyphs && <GlyphView text={player.name} />}
    </div>
  );
}

function NumberInput({ value, onChange, label, className, invalid, max = 100, ...rest }: { value: string; onChange: (v: string) => void; label: string; className?: string; invalid?: boolean; max?: number; "data-tour"?: string }) {
  return (
    <Input
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, String(max).length))}
      className={cn("text-center tabular-nums", className)}
      {...rest}
    />
  );
}

// ---------- group cards ----------
const position = (i: number) => `Row ${Math.floor(i / 3) + 1} · Col ${(i % 3) + 1}`;

export function GroupCard({
  kind,
  group,
  index,
  onChange,
  onRemove,
  showGlyphs,
  errors,
  focusNew,
  tour,
}: {
  kind: "SLOT_LIST" | "RESULTS";
  group: GroupDraft;
  index: number;
  onChange: (g: GroupDraft) => void;
  onRemove: () => void;
  showGlyphs: boolean;
  errors: DraftErrors;
  focusNew?: boolean;
  tour?: boolean;
}) {
  const gErr = errors.groups[group.key];
  const isSlots = kind === "SLOT_LIST";
  const numLow = !!group.numOcr && group.numOcr.confidence < LOW_CONFIDENCE && group.numOcr.text === group.num;
  const setPlayer = (pi: number, p: PlayerDraft) => onChange({ ...group, players: group.players.map((x, i) => (i === pi ? p : x)) });
  const removePlayer = (pi: number) => onChange({ ...group, players: group.players.filter((_, i) => i !== pi) });
  const filled = group.players.filter((p) => p.name.trim()).length;
  const totalKills = isSlots ? 0 : group.players.reduce((a, p) => a + (Number(p.kills) || 0), 0);

  return (
    <motion.section
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      aria-label={`${isSlots ? "Team card" : "Rank block"} ${index + 1}`}
      className={cn("rounded-xl border bg-card p-3 shadow-sm sm:p-4", (gErr?.num || gErr?.players) && "border-destructive/50", gErr?.warn && !gErr.num && "border-warning/60")}
      data-tour={tour ? "group-card" : undefined}
    >
      <div className="mb-3 flex items-start gap-3">
        <div className="shrink-0">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.2em] text-primary uppercase">{isSlots ? "Slot" : "Rank"}</div>
          <div className="relative flex items-center gap-1.5">
            {!isSlots && group.num === "1" && <Crown className="absolute -top-5 left-9 size-4 text-warning" aria-hidden />}
            <NumberInput
              value={group.num}
              onChange={(num) => onChange({ ...group, num })}
              label={isSlots ? `Slot number of card ${index + 1}` : `Rank of block ${index + 1}`}
              invalid={!!gErr?.num}
              className={cn("h-12 w-16 font-display text-2xl font-bold md:text-2xl", numLow && "border-warning/70 bg-warning/5")}
              data-tour={tour ? "group-number" : undefined}
            />
            <ConfidenceBadge hint={group.numOcr} />
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-4">
          <div className="text-xs text-muted-foreground">
            {isSlots ? position(index) : `Block ${index + 1}`} · {filled} {filled === 1 ? "player" : "players"}
            {!isSlots && <> · {totalKills} finishes</>}
          </div>
          {group.numOcr && group.numOcr.text !== group.num && <div className="text-[11px] text-muted-foreground">Model read: <span className="font-mono line-through decoration-destructive/60">{group.numOcr.text || "(nothing)"}</span></div>}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${isSlots ? "team" : "rank block"} ${index + 1}`} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove {isSlots ? "team" : "rank block"}</TooltipContent>
        </Tooltip>
      </div>
      {gErr?.num && <p className="-mt-1 mb-2 text-xs font-medium text-destructive">{gErr.num}</p>}
      {gErr?.warn && <p className="-mt-1 mb-2 flex items-center gap-1 text-xs font-medium text-warning-foreground dark:text-warning"><AlertTriangle className="size-3.5" />{gErr.warn}</p>}

      <ol className="grid gap-2">
        {group.players.map((p, pi) => {
          const pErr = errors.players[p.key];
          const killsLow = !!p.killsOcr && p.killsOcr.confidence < LOW_CONFIDENCE && p.killsOcr.text === p.kills;
          return (
            <li key={p.key} className="flex items-start gap-2">
              <span className="mt-2 w-4 shrink-0 text-right text-xs font-semibold text-muted-foreground tabular-nums">{pi + 1}</span>
              <NameField player={p} index={pi} onChange={(np) => setPlayer(pi, np)} showGlyphs={showGlyphs} error={pErr?.name} autoFocus={focusNew && pi === 0} />
              {!isSlots && (
                <div className="w-20 shrink-0">
                  <div className="relative">
                    <NumberInput value={p.kills} onChange={(kills) => setPlayer(pi, { ...p, kills })} label={`Finishes for player ${pi + 1}`} max={99} invalid={!!pErr?.kills} className={cn("h-9 pr-1", killsLow && "border-warning/70 bg-warning/5")} />
                  </div>
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                    finishes {p.killsOcr && <ConfidenceBadge hint={p.killsOcr} className="h-4 px-1 text-[10px]" />}
                  </div>
                  {p.killsOcr && p.killsOcr.text !== p.kills && <div className="text-center text-[10px] text-muted-foreground">read <span className="font-mono line-through">{p.killsOcr.text || "–"}</span></div>}
                  {pErr?.kills && <p className="mt-0.5 text-[11px] leading-tight font-medium text-destructive">{pErr.kills}</p>}
                </div>
              )}
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => removePlayer(pi)} aria-label={`Remove player ${pi + 1}`} className="mt-0.5 shrink-0 text-muted-foreground hover:text-destructive">
                <X />
              </Button>
            </li>
          );
        })}
      </ol>
      {gErr?.players && <p className="mt-2 text-xs font-medium text-destructive">{gErr.players}</p>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 text-muted-foreground"
        disabled={group.players.length >= MAX_ROSTER_PLAYERS}
        onClick={() => onChange({ ...group, players: [...group.players, emptyPlayer()] })}
      >
        <UserPlus /> {group.players.length >= MAX_ROSTER_PLAYERS ? `Max ${MAX_ROSTER_PLAYERS} players` : "Add player"}
      </Button>
    </motion.section>
  );
}

export function AddGroupButton({ kind, onClick, className }: { kind: "SLOT_LIST" | "RESULTS"; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour="add-group"
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm font-medium text-muted-foreground transition-colors outline-none hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <Plus className="size-4" /> {kind === "SLOT_LIST" ? "Add team card" : "Add rank block"}
    </button>
  );
}
