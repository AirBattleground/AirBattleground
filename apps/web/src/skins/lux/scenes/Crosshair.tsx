import { cn } from "@7xen/ui/lib/utils";

/** Reticle: ring, compass ticks, centre dot. `spin` slowly rotates the outer tick ring. */
export function Crosshair({ className, spin = true }: { className?: string; spin?: boolean }) {
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg aria-hidden viewBox="0 0 100 100" className={cn("lux-sc-scene lux-sc-crosshair pointer-events-none", className)}>
      <g className={spin ? "lux-sc-spin-slow" : undefined} stroke="var(--lux-khaki, var(--foreground))" strokeOpacity="0.55">
        {ticks.map((a) => (
          <line key={a} x1="50" y1="3" x2="50" y2={a % 90 === 0 ? 11 : a % 30 === 0 ? 8 : 6} strokeWidth={a % 90 === 0 ? 1.4 : 0.6} transform={`rotate(${a} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="30" fill="none" stroke="var(--primary)" strokeWidth="1.2" strokeDasharray="14 6" />
      <g stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="square">
        <line x1="50" y1="14" x2="50" y2="40" />
        <line x1="50" y1="60" x2="50" y2="86" />
        <line x1="14" y1="50" x2="40" y2="50" />
        <line x1="60" y1="50" x2="86" y2="50" />
      </g>
      <circle cx="50" cy="50" r="2" fill="var(--primary)" />
    </svg>
  );
}
