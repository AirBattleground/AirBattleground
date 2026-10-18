import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Ban, BadgeCheck, CheckSquare, FlaskConical, ImagePlus, Images, RefreshCw, SearchX, Sparkles, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import type { SampleSource, SampleSplit, ScreenshotKind, TrainingSampleRow, UpdateSampleInput } from "@7xen/shared";
import { EmptyState } from "@7xen/ui/components/brand/page";
import { Button } from "@7xen/ui/components/ui/button";
import { Checkbox } from "@7xen/ui/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@7xen/ui/components/ui/select";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@7xen/ui/components/ui/toggle-group";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { SearchInput } from "@/components/SearchInput";
import { AddScreenshotsDialog } from "@/features/training/AddScreenshotsDialog";
import { useBulkUpdateSamples, useSamples } from "@/features/training/api";
import { KindPill, SampleThumb, SplitPill, TrainingHeader, VerifiedPill } from "@/features/training/components";
import { SOURCE_LABELS } from "@/features/training/format";
import { setSampleNav } from "@/features/training/labels";
import { useDebounced } from "@/hooks/use-debounce";
import { errorMessage } from "@/lib/forms";
import { relativeTime } from "@/lib/format";

const TOUR: TourStep[] = [
  { title: "Training center", description: "A labelled test set of screenshots with the right answers. Use it to check how accurately Claude reads BGMI screenshots." },
  { element: '[data-tour="extractor-status"]', title: "Is the reader running?", description: "Shows whether Claude is set up on the server, which Claude model is in use, and how many screenshots are waiting.", side: "bottom" },
  { element: '[data-tour="training-metrics"]', title: "Your test set", description: "How many samples you have, how many are checked, and how many still need a look.", side: "bottom" },
  { element: '[data-tour="add-screenshots"]', title: "Add screenshots", description: "Upload BGMI screenshots. Claude reads them first, so you only fix mistakes.", side: "bottom" },
  { element: '[data-tour="sample-filters"]', title: "Filter", description: "Show team-list or results screenshots, training or test ones, and those that still need checking.", side: "bottom" },
  { element: '[data-tour="sample-grid"]', title: "Your samples", description: "Click a screenshot to open the label editor. Only samples marked 'Checked' count as right answers.", side: "top" },
];

type StatusFilter = "ALL" | "UNVERIFIED" | "VERIFIED" | "EXCLUDED";
const ALL = "ALL";

function matches(s: TrainingSampleRow, status: StatusFilter, source: SampleSource | typeof ALL) {
  if (source !== ALL && s.source !== source) return false;
  if (status === "UNVERIFIED") return !s.verified && !s.excluded;
  if (status === "VERIFIED") return s.verified && !s.excluded;
  if (status === "EXCLUDED") return s.excluded;
  return true;
}

function FilterSelect<T extends string>({ value, onChange, label, options }: { value: T; onChange: (v: T) => void; label: string; options: [T, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger aria-label={label} className="w-full bg-card sm:w-auto sm:min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SamplesPage() {
  usePageTour("admin.training.samples", TOUR);
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as ScreenshotKind | null) ?? undefined;
  const split = (params.get("split") as SampleSplit | null) ?? undefined;
  const status = (params.get("status")?.toUpperCase() as StatusFilter | undefined) ?? "ALL";
  const source = (params.get("source") as SampleSource | null) ?? ALL;
  const setParam = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(params);
    if (v && v !== ALL) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const list = useSamples({ kind, split, q });
  const bulk = useBulkUpdateSamples();
  const [addOpen, setAddOpen] = useState(() => params.get("add") === "1");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = useMemo(() => (list.data?.items ?? []).filter((s) => matches(s, status, source)), [list.data, status, source]);
  // next/previous in the label editor follows what you see here
  useEffect(() => {
    if (list.data) setSampleNav(items.map((s) => s.id));
  }, [items, list.data]);
  useEffect(() => {
    setSelected((cur) => new Set([...cur].filter((id) => items.some((s) => s.id === id))));
  }, [items]);

  const filtered = !!(kind || split || status !== "ALL" || source !== ALL || q);
  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const runBulk = async (input: UpdateSampleInput, verb: string) => {
    let ids = [...selected];
    if (input.verified) {
      const empty = items.filter((s) => selected.has(s.id) && s.nameCount === 0).map((s) => s.id);
      ids = ids.filter((id) => !empty.includes(id));
      if (empty.length) toast.warning(`${empty.length} skipped — they have no names labelled yet`);
      if (!ids.length) return;
    }
    try {
      const res = await bulk.mutateAsync({ ids, input });
      if (res.failed) toast.error(`${verb} ${res.ok} of ${ids.length}. ${errorMessage(res.firstError)}`);
      else toast.success(`${verb} ${res.ok} ${res.ok === 1 ? "sample" : "samples"}`);
      setSelected(new Set());
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const addBtn = (
    <Button size="lg" onClick={() => setAddOpen(true)} data-tour="add-screenshots" className="shadow-glow">
      <ImagePlus /> Add screenshots
    </Button>
  );

  const all = list.data?.items ?? [];
  const counts = {
    unverified: all.filter((s) => !s.verified && !s.excluded).length,
    ready: all.filter((s) => s.verified && !s.excluded).length,
  };

  let body: ReactNode;
  if (list.isPending)
    body = (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy aria-label="Loading">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <Skeleton className="aspect-[20/9] rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  else if (list.isError)
    body = (
      <EmptyState
        icon={<AlertTriangle />}
        title="Couldn't load samples"
        description={errorMessage(list.error)}
        action={
          <Button variant="outline" onClick={() => list.refetch()}>
            <RefreshCw /> Try again
          </Button>
        }
      />
    );
  else if (!items.length)
    body = filtered ? (
      <EmptyState
        icon={<SearchX />}
        title="No samples match"
        description="Try a different filter, or clear them all."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearch("");
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear filters
          </Button>
        }
      />
    ) : (
      <EmptyState icon={<Images />} title="No samples yet" description="Add a few BGMI screenshots. Claude reads them, you fix the names, and they become a test set for checking the reader." action={addBtn} />
    );
  else
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-tour="sample-grid">
        {items.map((s, i) => {
          const isSel = selected.has(s.id);
          return (
            <motion.li
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.025 }}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow",
                isSel && "border-primary ring-2 ring-primary/30",
                s.excluded && "opacity-70",
              )}
            >
              <Link to={`/training/samples/${s.id}`} className="block rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={`Open sample: ${s.kind === "SLOT_LIST" ? "team list" : "results"}, ${s.nameCount} names`}>
                <SampleThumb id={s.id} alt="" className={cn(s.excluded && "grayscale")} />
                <div className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <KindPill kind={s.kind} />
                    <VerifiedPill verified={s.verified} excluded={s.excluded} />
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <div className="min-w-0 text-xs text-muted-foreground">
                      <div className="truncate">{SOURCE_LABELS[s.source]}{s.createdBy ? ` · ${s.createdBy.displayName}` : ""}</div>
                      <div>Added {relativeTime(s.createdAt)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-2xl leading-none font-bold tabular-nums">{s.nameCount}</div>
                      <div className="text-[11px] text-muted-foreground">names</div>
                    </div>
                  </div>
                  {s.notes && <p className="mt-2 line-clamp-1 text-xs text-muted-foreground italic">“{s.notes}”</p>}
                </div>
              </Link>
              <div className="absolute top-2 left-2 rounded-md bg-background/85 p-1 shadow-sm backdrop-blur">
                <Checkbox checked={isSel} onCheckedChange={() => toggle(s.id)} aria-label="Select sample" />
              </div>
              <div className="absolute top-2 right-2">
                <SplitPill split={s.split} />
              </div>
            </motion.li>
          );
        })}
      </ul>
    );

  return (
    <>
      <TrainingHeader actions={addBtn} />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center" data-tour="sample-filters">
        <ToggleGroup
          type="single"
          variant="outline"
          value={kind ?? ALL}
          onValueChange={(v) => v && setParam("kind", v)}
          aria-label="Screenshot kind"
          className="bg-card"
        >
          <ToggleGroupItem value={ALL} className="px-3">All</ToggleGroupItem>
          <ToggleGroupItem value="SLOT_LIST" className="px-3">Team lists</ToggleGroupItem>
          <ToggleGroupItem value="RESULTS" className="px-3">Results</ToggleGroupItem>
        </ToggleGroup>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => setParam("status", v === "ALL" ? undefined : v.toLowerCase())}
            options={[
              ["ALL", "Any status"],
              ["UNVERIFIED", `Needs checking${counts.unverified ? ` (${counts.unverified})` : ""}`],
              ["VERIFIED", "Checked"],
              ["EXCLUDED", "Not used"],
            ]}
          />
          <FilterSelect label="Used for" value={split ?? ALL} onChange={(v) => setParam("split", v)} options={[[ALL, "Training + test"], ["TRAIN", "Training only"], ["TEST", "Test only"]]} />
          <FilterSelect
            label="Source"
            value={source}
            onChange={(v) => setParam("source", v)}
            options={[[ALL, "Any source"], ...(Object.entries(SOURCE_LABELS) as [SampleSource, string][])]}
          />
        </div>
        <SearchInput value={search} onChange={setSearch} placeholder="Search names or notes…" loading={list.isFetching && !list.isPending} className="lg:ml-auto" />
      </div>

      {list.data && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {items.length} {items.length === 1 ? "sample" : "samples"}
            {filtered && " shown"}
          </span>
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="size-4 text-success" /> {counts.ready} checked
          </span>
          {items.length > 0 && (
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((s) => s.id)))}
            >
              <CheckSquare className="size-4" /> {selected.size === items.length ? "Clear selection" : "Select all shown"}
            </button>
          )}
        </div>
      )}

      {body}

      {selected.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          role="toolbar"
          aria-label="Bulk actions"
          className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-popover/95 p-3 shadow-glow backdrop-blur"
        >
          <span className="mr-1 font-display text-lg font-bold">{selected.size} selected</span>
          <Button size="sm" onClick={() => runBulk({ verified: true }, "Marked as checked:")} disabled={bulk.isPending}>
            <BadgeCheck /> Mark checked
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk({ verified: false }, "Marked as needs checking:")} disabled={bulk.isPending}>
            <Undo2 /> Needs checking
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk({ excluded: true }, "Won't use")} disabled={bulk.isPending}>
            <Ban /> Don't use
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk({ excluded: false }, "Will use")} disabled={bulk.isPending}>
            Use again
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk({ split: "TRAIN" }, "Moved to training:")} disabled={bulk.isPending}>
            <Sparkles /> Move to training
          </Button>
          <Button size="sm" variant="outline" onClick={() => runBulk({ split: "TEST" }, "Moved to test:")} disabled={bulk.isPending}>
            <FlaskConical /> Move to test
          </Button>
          <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X />
          </Button>
        </motion.div>
      )}

      <AddScreenshotsDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o && params.get("add")) setParam("add", undefined);
        }}
      />
    </>
  );
}
