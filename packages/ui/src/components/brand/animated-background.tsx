import { cn } from "@7xen/ui/lib/utils";

/**
 * Slowly drifting aurora blobs + grid + vignette. Colours come from theme tokens
 * (--aurora-1/2/3, --grid-line) so it cross-fades with the theme. Place as the first
 * child of a `relative` container; it sits behind content (-z-10) and ignores pointer events.
 * `intensity="subtle"` for app shells, `"hero"` for login/landing screens.
 */
export function AnimatedBackground({ className, intensity = "subtle" }: { className?: string; intensity?: "subtle" | "hero" }) {
  const hero = intensity === "hero";
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)}>
      <div className={cn("absolute inset-0 bg-grid", hero ? "opacity-100" : "opacity-60", "[mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]")} />
      <div
        className={cn("absolute -top-1/3 -left-1/4 rounded-full blur-3xl animate-aurora", hero ? "size-[70vmax]" : "size-[50vmax] opacity-70")}
        style={{ background: "radial-gradient(circle, var(--aurora-1), transparent 65%)" }}
      />
      <div
        className={cn("absolute -right-1/4 -bottom-1/3 rounded-full blur-3xl animate-aurora [animation-delay:-6s]", hero ? "size-[65vmax]" : "size-[45vmax] opacity-70")}
        style={{ background: "radial-gradient(circle, var(--aurora-2), transparent 65%)" }}
      />
      {hero && (
        <div
          className="absolute top-1/4 left-1/2 size-[40vmax] rounded-full blur-3xl animate-aurora [animation-delay:-11s]"
          style={{ background: "radial-gradient(circle, var(--aurora-3), transparent 65%)" }}
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,var(--background)_100%)]" />
    </div>
  );
}
