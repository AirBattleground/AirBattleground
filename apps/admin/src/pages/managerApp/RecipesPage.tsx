import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Braces, Eye, ListChecks, Pencil, Plus, ScanSearch, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RECIPE_KEYS, saveRecipeSchema, type Recipe, type RecipeKey, type RecipeStep } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Pill } from "@7xen/ui/components/brand/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@7xen/ui/components/ui/alert-dialog";
import { Button } from "@7xen/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@7xen/ui/components/ui/dialog";
import { Input } from "@7xen/ui/components/ui/input";
import { Label } from "@7xen/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { Textarea } from "@7xen/ui/components/ui/textarea";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useAdminRecipes, useDeleteRecipe, useSaveRecipe } from "@/features/managerApp/api";
import { ManagerAppHeader } from "@/features/managerApp/components";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Recipes", description: "A recipe is the list of steps the app walks through in BGMI — for example creating a custom room. Managers start from these defaults." },
  { element: '[data-tour="recipe-card"]', title: "One per job", description: "Create room, open the team list, scroll the results. Each has a default every manager's app downloads.", side: "bottom" },
  { element: '[data-tour="recipe-edit"]', title: "Edit the steps", description: "Change the checklist text, hints and what each step does. Positions are fractions of the game screen (0 = left/top, 1 = right/bottom).", side: "left" },
];

const KEY_INFO: Record<RecipeKey, { title: string; text: string }> = {
  CREATE_ROOM: { title: "Create room", text: "Custom Room → Create → map, mode, slots, password." },
  OPEN_TEAM_LIST: { title: "Open team list", text: "Opens the in-game team list so it can be captured." },
  SCROLL_RESULTS: { title: "Scroll results", text: "Swipes through the results screen so every rank is captured." },
};

type ActionType = RecipeStep["action"]["type"];
const ACTIONS: { value: ActionType; label: string }[] = [
  { value: "tap", label: "Tap" },
  { value: "swipe", label: "Swipe" },
  { value: "wait", label: "Wait" },
  { value: "input_text", label: "Type password" },
  { value: "read_text", label: "Read text" },
  { value: "manual", label: "Manager does it" },
];

function defaultAction(type: ActionType): RecipeStep["action"] {
  switch (type) {
    case "tap":
      return { type, x: 0.5, y: 0.5 };
    case "swipe":
      return { type, x: 0.5, y: 0.7, x2: 0.5, y2: 0.3, durationMs: 400 };
    case "wait":
      return { type, ms: 1000 };
    case "input_text":
      return { type, field: "roomPassword" };
    case "read_text":
      return { type, field: "roomId", region: [0.4, 0.1, 0.6, 0.2] };
    case "manual":
      return { type };
  }
}

function actionSummary(a: RecipeStep["action"]): string {
  const p = (n: number) => n.toFixed(2);
  switch (a.type) {
    case "tap":
      return `Tap at ${p(a.x)}, ${p(a.y)}`;
    case "swipe":
      return `Swipe ${p(a.x)},${p(a.y)} → ${p(a.x2)},${p(a.y2)}`;
    case "wait":
      return `Wait ${(a.ms / 1000).toFixed(1)} s`;
    case "input_text":
      return "Type the room password";
    case "read_text":
      return `Read ${a.field === "roomId" ? "room ID" : "password"} from the screen`;
    case "manual":
      return "Manager does it by hand";
  }
}

const newId = () => `s${Math.random().toString(36).slice(2, 8)}`;
const blankStep = (): RecipeStep => ({ id: newId(), label: "", action: { type: "manual" }, timeoutMs: 15000 });

function NumField({ label, value, onChange, step = 0.01, min = 0, max = 1, disabled }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
      {label}
      <Input type="number" inputMode="decimal" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} className="h-9 w-full font-mono text-sm normal-case" />
    </label>
  );
}

function ActionParams({ a, set, readOnly }: { a: RecipeStep["action"]; set: (a: RecipeStep["action"]) => void; readOnly: boolean }) {
  const grid = "grid grid-cols-2 gap-2 sm:grid-cols-4";
  switch (a.type) {
    case "tap":
      return (
        <div className={grid}>
          <NumField label="X" value={a.x} onChange={(x) => set({ ...a, x })} disabled={readOnly} />
          <NumField label="Y" value={a.y} onChange={(y) => set({ ...a, y })} disabled={readOnly} />
        </div>
      );
    case "swipe":
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <NumField label="From X" value={a.x} onChange={(x) => set({ ...a, x })} disabled={readOnly} />
          <NumField label="From Y" value={a.y} onChange={(y) => set({ ...a, y })} disabled={readOnly} />
          <NumField label="To X" value={a.x2} onChange={(x2) => set({ ...a, x2 })} disabled={readOnly} />
          <NumField label="To Y" value={a.y2} onChange={(y2) => set({ ...a, y2 })} disabled={readOnly} />
          <NumField label="ms" value={a.durationMs} step={50} min={50} max={3000} onChange={(durationMs) => set({ ...a, durationMs })} disabled={readOnly} />
        </div>
      );
    case "wait":
      return (
        <div className={grid}>
          <NumField label="Wait (ms)" value={a.ms} step={100} min={100} max={30000} onChange={(ms) => set({ ...a, ms })} disabled={readOnly} />
        </div>
      );
    case "read_text":
      return (
        <div className="space-y-2">
          <Select value={a.field} onValueChange={(v) => set({ ...a, field: v as "roomId" | "roomPassword" })} disabled={readOnly}>
            <SelectTrigger className="h-9 w-full sm:w-56" aria-label="What to read">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="roomId">Room ID</SelectItem>
              <SelectItem value="roomPassword">Room password</SelectItem>
            </SelectContent>
          </Select>
          <div className={grid}>
            {(["Left", "Top", "Right", "Bottom"] as const).map((l, i) => (
              <NumField
                key={l}
                label={l}
                value={a.region[i]!}
                disabled={readOnly}
                onChange={(n) => {
                  const region = [...a.region] as [number, number, number, number];
                  region[i] = n;
                  set({ ...a, region });
                }}
              />
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function StepRow({ step, index, count, readOnly, onChange, onMove, onRemove }: { step: RecipeStep; index: number; count: number; readOnly: boolean; onChange: (s: RecipeStep) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void }) {
  return (
    <li className="rounded-xl border bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-bold text-primary">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <Input value={step.label} onChange={(e) => onChange({ ...step, label: e.target.value })} placeholder="Checklist text, e.g. Open Custom Room" aria-label={`Step ${index + 1} label`} disabled={readOnly} className="h-9 font-medium" />
            <Select value={step.action.type} onValueChange={(v) => onChange({ ...step, action: defaultAction(v as ActionType) })} disabled={readOnly}>
              <SelectTrigger className="h-9 w-full" aria-label={`Step ${index + 1} action`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input value={step.hint ?? ""} onChange={(e) => onChange({ ...step, hint: e.target.value || undefined })} placeholder="Hint (optional), e.g. Bottom-right corner of the lobby" aria-label={`Step ${index + 1} hint`} disabled={readOnly} className="h-9 text-sm" />
          <ActionParams a={step.action} set={(action) => onChange({ ...step, action })} readOnly={readOnly} />
          {step.expect && (
            <Pill tone="info" icon={<ScanSearch className="size-3.5" />}>
              Waits for its screen (fingerprint)
            </Pill>
          )}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 flex-col">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove step" className="text-muted-foreground hover:text-destructive" disabled={count === 1} onClick={onRemove}>
              <Trash2 />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function firstIssue(err: { issues: { path: (string | number)[]; message: string }[] }): string {
  const i = err.issues[0];
  if (!i) return "Check the recipe.";
  const [a, b, ...rest] = i.path;
  if (a === "steps" && typeof b === "number") return `Step ${b + 1}${rest.length ? ` (${rest.join(".")})` : ""}: ${i.message}`;
  return `${i.path.join(".") || "Recipe"}: ${i.message}`;
}

function RecipeEditor({ recipeKey, recipe, readOnly, onClose }: { recipeKey: RecipeKey; recipe: Recipe | null; readOnly: boolean; onClose: () => void }) {
  const save = useSaveRecipe();
  const [name, setName] = useState(recipe?.name ?? KEY_INFO[recipeKey].title);
  const [deviceProfile, setDeviceProfile] = useState(recipe?.deviceProfile ?? "");
  const [steps, setSteps] = useState<RecipeStep[]>(() => (recipe?.steps.length ? recipe.steps.map((s) => ({ ...s })) : [blankStep()]));
  const [json, setJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStep = (i: number, s: RecipeStep) => setSteps((all) => all.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((all) => {
      const next = [...all];
      const [s] = next.splice(i, 1);
      next.splice(i + d, 0, s!);
      return next;
    });

  const toggleJson = () => {
    if (json == null) {
      setJson(JSON.stringify(steps, null, 2));
      setError(null);
      return;
    }
    try {
      const parsed = saveRecipeSchema.shape.steps.safeParse(JSON.parse(json));
      if (!parsed.success) {
        setError(firstIssue({ issues: parsed.error.issues.map((x) => ({ ...x, path: ["steps", ...x.path] })) }));
        return;
      }
      setSteps(parsed.data);
      setJson(null);
      setError(null);
    } catch {
      setError("That isn't valid JSON.");
    }
  };

  const submit = () => {
    let list = steps;
    if (json != null) {
      try {
        list = JSON.parse(json) as RecipeStep[];
      } catch {
        setError("That isn't valid JSON.");
        return;
      }
    }
    const parsed = saveRecipeSchema.safeParse({ name, deviceProfile: deviceProfile.trim() || null, steps: list });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }
    setError(null);
    save.mutate(
      { key: recipeKey, input: parsed.data },
      {
        onSuccess: (r) => {
          toast.success("Recipe saved", { description: `Version ${r.version} — managers' apps pick it up next time they open.` });
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-display text-2xl">
            {readOnly ? "View" : recipe ? "Edit" : "Create"} · {KEY_INFO[recipeKey].title}
          </DialogTitle>
          <DialogDescription>
            {recipe?.scope === "MANAGER" ? "Taught by a manager on their phone — read only." : "The default every manager's app starts from. Positions are fractions of the game screen (0–1)."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 space-y-4 overflow-y-auto px-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recipe-name">Name</Label>
              <Input id="recipe-name" value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recipe-device">Made on screen size (optional)</Label>
              <Input id="recipe-device" value={deviceProfile} onChange={(e) => setDeviceProfile(e.target.value)} placeholder="e.g. 2400x1080" disabled={readOnly} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold">
              Steps <span className="text-sm font-normal text-muted-foreground">{json == null ? steps.length : ""}</span>
            </h3>
            <Button type="button" variant="outline" size="sm" onClick={toggleJson}>
              {json == null ? (
                <>
                  <Braces /> {readOnly ? "View JSON" : "Edit as JSON"}
                </>
              ) : (
                <>
                  <ListChecks /> Back to steps
                </>
              )}
            </Button>
          </div>
          {json != null ? (
            <Textarea value={json} onChange={(e) => setJson(e.target.value)} readOnly={readOnly} spellCheck={false} className="min-h-80 font-mono text-xs" aria-label="Steps as JSON" />
          ) : (
            <ol className="space-y-2">
              {steps.map((s, i) => (
                <StepRow
                  key={s.id}
                  step={s}
                  index={i}
                  count={steps.length}
                  readOnly={readOnly}
                  onChange={(n) => setStep(i, n)}
                  onMove={(d) => move(i, d)}
                  onRemove={() => setSteps((all) => all.filter((_, j) => j !== i))}
                />
              ))}
            </ol>
          )}
          {!readOnly && json == null && (
            <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setSteps((all) => [...all, blankStep()])} disabled={steps.length >= 60}>
              <Plus /> Add step
            </Button>
          )}
        </div>
        <div className="space-y-3">
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button type="button" onClick={submit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save recipe"}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecipeCard({ k, def, taught, first, onEdit, onView, onDelete }: { k: RecipeKey; def: Recipe | null; taught: Recipe[]; first: boolean; onEdit: () => void; onView: (r: Recipe) => void; onDelete: (r: Recipe) => void }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4 shadow-sm sm:p-5" data-tour={first ? "recipe-card" : undefined}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <ListChecks className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl leading-tight font-bold">{KEY_INFO[k].title}</h2>
          <p className="text-sm text-muted-foreground">{KEY_INFO[k].text}</p>
        </div>
      </div>
      {def ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone="brand">Default · v{def.version}</Pill>
            <span className="text-muted-foreground">
              {def.steps.length} step{def.steps.length === 1 ? "" : "s"} · updated {relativeTime(def.updatedAt)}
              {def.deviceProfile ? ` · ${def.deviceProfile}` : ""}
            </span>
          </div>
          <ol className="space-y-1 rounded-lg border bg-background/60 p-2.5 text-sm">
            {def.steps.slice(0, 4).map((s, i) => (
              <li key={s.id} className="flex gap-2">
                <span className="w-5 shrink-0 text-right font-display font-bold text-primary">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{actionSummary(s.action)}</span>
              </li>
            ))}
            {def.steps.length > 4 && <li className="pl-7 text-xs text-muted-foreground">+ {def.steps.length - 4} more</li>}
          </ol>
          <div className="flex gap-2">
            <Button size="sm" onClick={onEdit} data-tour={first ? "recipe-edit" : undefined}>
              <Pencil /> Edit steps
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(def)}>
              <Trash2 /> Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">No default yet — managers' apps use their built-in steps until you add one.</p>
          <Button size="sm" onClick={onEdit} data-tour={first ? "recipe-edit" : undefined}>
            <Plus /> Create default
          </Button>
        </div>
      )}
      {taught.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <Smartphone className="size-3.5" /> Taught by managers
          </p>
          <ul className="space-y-1">
            {taught.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {r.manager?.displayName ?? r.name} <span className="text-muted-foreground">· v{r.version}{r.deviceProfile ? ` · ${r.deviceProfile}` : ""}</span>
                </span>
                <Button size="icon-sm" variant="ghost" aria-label={`View ${r.name}`} onClick={() => onView(r)}>
                  <Eye />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(r)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function RecipesPage() {
  usePageTour("admin.recipes", TOUR);
  const list = useAdminRecipes();
  const del = useDeleteRecipe();
  const [editing, setEditing] = useState<{ key: RecipeKey; recipe: Recipe | null; readOnly: boolean } | null>(null);
  const [deleting, setDeleting] = useState<Recipe | null>(null);
  const items = list.data?.items ?? [];

  return (
    <>
      <ManagerAppHeader title="Recipes" description="The touch steps the 7XEN Manager app follows in BGMI. Update them when the game changes its screens." />
      {list.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {RECIPE_KEYS.map((k) => (
            <Skeleton key={k} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState icon={<AlertTriangle />} title="Couldn't load recipes" description={errorMessage(list.error)} action={<Button onClick={() => void list.refetch()}>Try again</Button>} />
      ) : (
        <div className={cn("grid gap-4 lg:grid-cols-3")}>
          {RECIPE_KEYS.map((k, i) => {
            const mine = items.filter((r) => r.key === k);
            const def = mine.filter((r) => r.scope === "DEFAULT").sort((a, b) => b.version - a.version)[0] ?? null;
            return (
              <RecipeCard
                key={k}
                k={k}
                def={def}
                taught={mine.filter((r) => r.scope === "MANAGER")}
                first={i === 0}
                onEdit={() => setEditing({ key: k, recipe: def, readOnly: false })}
                onView={(r) => setEditing({ key: k, recipe: r, readOnly: true })}
                onDelete={setDeleting}
              />
            );
          })}
        </div>
      )}

      {editing && <RecipeEditor recipeKey={editing.key} recipe={editing.recipe} readOnly={editing.readOnly} onClose={() => setEditing(null)} />}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.scope === "DEFAULT"
                ? "Managers' apps fall back to their built-in steps (or their own taught version) until you add a new default."
                : "The manager's phone keeps working with the default recipe and can teach it again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                del.mutate(deleting.id, {
                  onSuccess: () => toast.success("Recipe deleted"),
                  onError: (err) => toast.error("Couldn't delete the recipe", { description: errorMessage(err) }),
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
