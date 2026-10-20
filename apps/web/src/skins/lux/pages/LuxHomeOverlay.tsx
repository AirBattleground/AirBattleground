import { AircraftFlyover, ParachuteDrop } from "../scenes";

/**
 * Lux-only flyover laid over the team home hero (the hero itself keeps every feature: next match, slot, stats).
 * Decorative: a transport plane crossing the top edge and chutes drifting down the left side, clipped to the hero.
 */
export default function LuxHomeOverlay() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-3xl">
      <AircraftFlyover top="4%" angle={-3} duration={20} size={84} className="opacity-70" />
      <ParachuteDrop count={4} className="absolute inset-y-0 left-[38%] w-[22%] opacity-60 max-md:hidden" />
    </div>
  );
}
