import { useState } from "react";
import { CheckCircle2, ExternalLink, Palette } from "lucide-react";
import { toast } from "sonner";
import { UI_SKIN_LABELS, UI_SKINS, type UiSkin } from "@7xen/shared";
import { PageHeader } from "@7xen/ui/components/brand/page";
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
import { Badge } from "@7xen/ui/components/ui/badge";
import { Button } from "@7xen/ui/components/ui/button";
import { Skeleton } from "@7xen/ui/components/ui/skeleton";
import { cn } from "@7xen/ui/lib/utils";
import { usePageTour, type TourStep } from "@7xen/ui/tour";
import { useSetSiteSkin, useSiteSkin } from "@/features/siteLook/api";
import { errorMessage } from "@/lib/forms";

const TOUR: TourStep[] = [
  { title: "Site look", description: "Pick how the website looks for every team and manager. Features stay exactly the same." },
  { element: '[data-tour="skin-teal"]', title: "Teal Battle", description: "The calm app look with a side menu.", side: "bottom" },
  { element: '[data-tour="skin-lux"]', title: "Lux Battle", description: "A branded esports site: top menu, tactical graphics and lots of animation.", side: "bottom" },
  { element: '[data-tour="skin-arena"]', title: "Arena", description: "A game lobby: HUD top bar, your squad on stage and one big Find match button.", side: "bottom" },
  { element: '[data-tour="skin-preview"]', title: "Try it first", description: "Opens the website in a new tab with this look, only for you. Nothing changes for anyone else.", side: "top" },
];

/** Tiny wireframe of each look, drawn with theme tokens. */
function Mock({ skin }: { skin: UiSkin }) {
  if (skin === "teal") {
    return (
      <div aria-hidden className="flex h-32 overflow-hidden rounded-lg border bg-background">
        <div className="flex w-12 flex-col gap-1.5 border-r bg-muted/60 p-2">
          <span className="size-4 rounded bg-primary/70" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1.5 rounded-full", i === 0 ? "bg-primary/60" : "bg-muted-foreground/25")} />
          ))}
        </div>
        <div className="flex-1 space-y-2 p-3">
          <span className="block h-2.5 w-24 rounded-full bg-foreground/30" />
          <div className="grid grid-cols-3 gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-10 rounded-md border bg-card" />
            ))}
          </div>
          <span className="block h-6 rounded-md border bg-card" />
        </div>
      </div>
    );
  }
  if (skin === "arena") {
    return (
      <div aria-hidden className="relative h-32 overflow-hidden rounded-sm border bg-[oklch(0.13_0.02_205)]">
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 border-b border-[oklch(0.85_0.08_190/0.2)] px-2 py-1.5">
          <span className="size-3.5 rounded-sm bg-[oklch(0.78_0.13_190)]" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1.5 w-7", i === 0 ? "bg-[oklch(0.78_0.13_190)]" : "bg-[oklch(0.85_0.08_190/0.3)]")} />
          ))}
          <span className="ml-auto flex items-center gap-1">
            <span className="size-2.5 rounded-full bg-[oklch(0.83_0.16_85)]" />
            <span className="h-1.5 w-6 bg-[oklch(0.83_0.16_85/0.6)]" />
          </span>
        </div>
        <span className="absolute top-8 left-2 h-14 w-12 border border-[oklch(0.85_0.08_190/0.3)] bg-[oklch(0.17_0.03_205/0.8)]" />
        <span className="absolute top-8 right-2 h-9 w-14 border border-[oklch(0.83_0.16_85/0.4)] bg-[oklch(0.45_0.18_25/0.6)]" />
        <span className="absolute bottom-3 left-1/2 h-4 w-28 -translate-x-1/2 rounded-[50%] border border-[oklch(0.78_0.13_190/0.7)] shadow-[0_0_14px_oklch(0.78_0.13_190/0.6)]" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="absolute bottom-5 h-12 w-3.5 rounded-t-full bg-[oklch(0.7_0.08_190/0.55)]" style={{ left: `${40 + i * 6}%` }} />
        ))}
        <span className="absolute right-2 bottom-2 h-6 w-16 bg-[oklch(0.83_0.16_85)] [clip-path:polygon(0_0,100%_0,100%_65%,88%_100%,0_100%)]" />
      </div>
    );
  }
  return (
    <div aria-hidden className="relative h-32 overflow-hidden rounded-sm border bg-[oklch(0.15_0.012_120)]">
      <div className="flex items-center gap-2 border-b border-[oklch(0.8_0.06_85/0.2)] px-2 py-1.5">
        <span className="size-3.5 rotate-45 bg-[oklch(0.72_0.19_50)]" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1.5 w-7", i === 1 ? "bg-[oklch(0.72_0.19_50)]" : "bg-[oklch(0.8_0.06_85/0.35)]")} />
        ))}
        <span className="ml-auto h-3 w-10 bg-[oklch(0.72_0.19_50)] [clip-path:polygon(0_0,85%_0,100%_50%,85%_100%,0_100%)]" />
      </div>
      <svg viewBox="0 0 200 100" className="absolute inset-x-0 bottom-0 h-[85%] w-full opacity-60">
        {[18, 30, 42].map((r) => (
          <circle key={r} cx="150" cy="58" r={r} fill="none" stroke="oklch(0.82 0.18 145 / 0.45)" strokeWidth="0.8" />
        ))}
        <path d="M0 30 C 50 20, 90 45, 200 15" fill="none" stroke="oklch(0.8 0.06 85 / 0.5)" strokeDasharray="3 3" />
        <path d="M60 22 l8 3 -8 3 2 -3z" fill="oklch(0.8 0.06 85)" />
        <text x="10" y="62" fontSize="14" fontWeight="700" fill="oklch(0.92 0.03 85)" letterSpacing="1">DROP IN</text>
        <rect x="10" y="70" width="44" height="9" fill="oklch(0.72 0.19 50)" />
      </svg>
    </div>
  );
}

export default function SiteLookPage() {
  usePageTour("admin.siteLook", TOUR);
  const current = useSiteSkin();
  const setSkin = useSetSiteSkin();
  const [selected, setSelected] = useState<UiSkin | null>(null);
  const [confirm, setConfirm] = useState(false);
  const active = current.data?.skin;
  const picked = selected ?? active ?? "teal";

  const apply = () => {
    setSkin.mutate(
      { skin: picked },
      {
        onSuccess: (r) => {
          toast.success("Site look changed", { description: `Everyone now sees ${UI_SKIN_LABELS[r.skin].name}.` });
          setSelected(null);
        },
        onError: (e) => toast.error("Couldn't change the look", { description: errorMessage(e) }),
        onSettled: () => setConfirm(false),
      },
    );
  };

  return (
    <>
      <PageHeader eyebrow="Website" title="Site look" description="Choose how the website looks for every team and manager. Same pages and features — only the design changes." />

      {current.isPending ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div role="radiogroup" aria-label="Site look" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {UI_SKINS.map((s) => {
            const isPicked = picked === s;
            const isLive = active === s;
            return (
              <div
                key={s}
                role="radio"
                aria-checked={isPicked}
                tabIndex={0}
                data-tour={`skin-${s}`}
                onClick={() => setSelected(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(s);
                  }
                }}
                className={cn(
                  "group relative flex flex-col gap-4 rounded-xl border bg-card p-5 text-left shadow-sm outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  isPicked ? "border-primary shadow-glow" : "hover:border-primary/40",
                )}
              >
                <Mock skin={s} />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-bold">{UI_SKIN_LABELS[s].name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{UI_SKIN_LABELS[s].description}</p>
                  </div>
                  {isLive ? (
                    <Badge className="shrink-0 gap-1 bg-success/15 text-success">
                      <CheckCircle2 className="size-3.5" /> Live now
                    </Badge>
                  ) : isPicked ? (
                    <Badge variant="outline" className="shrink-0 border-primary/40 text-primary">
                      Selected
                    </Badge>
                  ) : null}
                </div>
                <Button asChild variant="outline" size="sm" className="self-start" data-tour={s === "lux" ? "skin-preview" : undefined} onClick={(e) => e.stopPropagation()}>
                  <a href={`/?skin=${s}`} target="_blank" rel="noreferrer">
                    Preview in a new tab <ExternalLink />
                  </a>
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={!active || picked === active || setSkin.isPending} onClick={() => setConfirm(true)}>
          <Palette /> Use {UI_SKIN_LABELS[picked].name} for everyone
        </Button>
        {active && picked === active && <span className="text-sm text-muted-foreground">This look is already live.</span>}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch everyone to {UI_SKIN_LABELS[picked].name}?</AlertDialogTitle>
            <AlertDialogDescription>
              All teams and managers will see the new look the next time a page loads. Nothing else changes, and you can switch back any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                apply();
              }}
              disabled={setSkin.isPending}
            >
              {setSkin.isPending ? "Switching…" : "Switch look"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
