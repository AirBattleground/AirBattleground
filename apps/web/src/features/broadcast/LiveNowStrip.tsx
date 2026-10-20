import { Radio } from "lucide-react";
import { SectionHeader } from "@/features/team/home/SectionHeader";
import { LiveCard } from "./LiveCard";
import { useLiveBroadcasts } from "./live";

/** Home: every match being broadcast right now (anyone can watch). Renders nothing while nothing is live. */
export function LiveNowStrip({ base = "/team" }: { base?: string }) {
  const q = useLiveBroadcasts();
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <section className="space-y-4" data-tour="home-live">
      <SectionHeader
        eyebrow="Streaming now"
        title={
          <>
            Live now <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 align-middle text-sm text-destructive-foreground">{items.length}</span>
          </>
        }
        icon={<Radio />}
        description="Matches organisers are broadcasting right now. Tap to watch."
        to={items.length > 3 ? `${base}/live` : undefined}
      />
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
        {items.slice(0, 3).map((b) => (
          <div key={b.matchId} className="w-[80%] shrink-0 snap-start sm:w-auto">
            <LiveCard b={b} to={`${base}/live/${b.matchId}`} />
          </div>
        ))}
      </div>
    </section>
  );
}
