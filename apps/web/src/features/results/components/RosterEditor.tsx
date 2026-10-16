import { useEffect } from "react";
import { useFieldArray, useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Gamepad2, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { ApiError, MAX_ROSTER_PLAYERS, saveRosterSchema, type TeamRoster } from "@7xen/shared";
import { Button } from "@7xen/ui/components/ui/button";
import { Input } from "@7xen/ui/components/ui/input";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@7xen/ui/lib/utils";
import { errorMessage } from "@/features/manager/api";
import { useRoster, useSaveRoster } from "../api";

interface FormValues {
  players: { ign: string; bgmiId: string }[];
}

const toForm = (r: TeamRoster): FormValues => ({ players: r.players.map((p) => ({ ign: p.ign, bgmiId: p.bgmiId ?? "" })) });

/** Team roster: in-game names (+ optional BGMI ID). Matching names lets results be read automatically. */
export function RosterEditor() {
  const q = useRoster();
  const save = useSaveRoster();
  const form = useForm<FormValues>({
    // the schema transforms "" → undefined for bgmiId; the form keeps strings
    resolver: zodResolver(saveRosterSchema) as unknown as Resolver<FormValues>,
    defaultValues: { players: [] },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "players" });

  useEffect(() => {
    if (q.data) form.reset(toForm(q.data));
  }, [q.data, form]);

  const players = form.watch("players");
  const have = new Set(players.map((p) => p.ign.trim().toLowerCase()));
  const suggestions = (q.data?.suggestions ?? []).filter((s) => !have.has(s.trim().toLowerCase()));
  const full = fields.length >= MAX_ROSTER_PLAYERS;

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(
      { players: v.players.map((p) => ({ ign: p.ign.trim(), bgmiId: p.bgmiId.trim() || undefined })) },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.fields) {
            for (const [k, msg] of Object.entries(err.fields)) form.setError(k as `players.${number}.ign`, { message: msg });
          }
          toast.error("Couldn't save the roster", { description: errorMessage(err) });
        },
      },
    ),
  );

  return (
    <section data-tour="roster" className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
      <div className="pointer-events-none absolute -right-16 -bottom-16 size-56 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-fit rounded-2xl bg-primary/10 p-4 text-primary">
          <Users className="size-7" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-xl font-bold">Roster & player IDs</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your players exactly as their names appear in the game. When organisers upload result screenshots, 7xen matches these names to
            fill in your team's finishes automatically. Up to {MAX_ROSTER_PLAYERS} players (including substitutes).
          </p>
        </div>
      </div>

      {q.isError ? (
        <p className="relative mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          Couldn't load your roster. {errorMessage(q.error)}{" "}
          <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </p>
      ) : !q.data ? (
        <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="relative mt-5 space-y-4" noValidate>
          {suggestions.length > 0 && (
            <div className="rounded-xl border border-info/30 bg-info/10 p-3" data-tour="roster-suggestions">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="size-4 text-info" /> Names we've seen in your matches
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <Button key={s} type="button" size="sm" variant="outline" disabled={full} onClick={() => append({ ign: s, bgmiId: "" })} className="bg-background">
                    <Plus /> {s}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {fields.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No players yet. Add your first player below.
            </div>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {fields.map((f, i) => {
                const errs = form.formState.errors.players?.[i];
                return (
                  <li key={f.id} className="flex items-start gap-2 rounded-xl border bg-background/60 p-3">
                    <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 font-display text-sm font-bold text-primary">
                      {i < 4 ? i + 1 : <Gamepad2 className="size-4" />}
                    </span>
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                      <div>
                        <Input
                          {...form.register(`players.${i}.ign`)}
                          placeholder={i < 4 ? "In-game name" : "Substitute IGN"}
                          aria-label={`Player ${i + 1} in-game name`}
                          aria-invalid={!!errs?.ign}
                          maxLength={40}
                          className="font-medium"
                        />
                        {errs?.ign && <p className="mt-1 text-xs text-destructive">{errs.ign.message}</p>}
                      </div>
                      <div>
                        <Input
                          {...form.register(`players.${i}.bgmiId`)}
                          placeholder="BGMI ID"
                          inputMode="numeric"
                          aria-label={`Player ${i + 1} BGMI ID`}
                          aria-invalid={!!errs?.bgmiId}
                          className={cn("font-mono text-sm")}
                        />
                        {errs?.bgmiId && <p className="mt-1 text-xs text-destructive">{errs.bgmiId.message}</p>}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove player ${i + 1}`}
                      onClick={() => remove(i)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" disabled={full} onClick={() => append({ ign: "", bgmiId: "" })}>
              <Plus /> {full ? `Roster full (${MAX_ROSTER_PLAYERS})` : "Add player"}
            </Button>
            <div className="flex gap-2">
              {form.formState.isDirty && (
                <Button type="button" variant="ghost" onClick={() => q.data && form.reset(toForm(q.data))}>
                  Undo changes
                </Button>
              )}
              <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
                {save.isPending ? "Saving…" : "Save roster"}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
