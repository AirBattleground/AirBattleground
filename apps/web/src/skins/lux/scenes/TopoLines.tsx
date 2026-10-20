import { cn } from "@7xen/ui/lib/utils";

/** Deterministic pseudo-random (so SSR/re-renders draw the same terrain). */
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Closed smooth path (Catmull-Rom → cubic Bézier) through points. */
function smoothClosed(pts: [number, number][]) {
  const n = pts.length;
  const p = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = p(i - 1);
    const [x1, y1] = p(i);
    const [x2, y2] = p(i + 1);
    const [x3, y3] = p(i + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Contour rings around a few "peaks" — computed once per seed. */
function terrain(seed: number) {
  const r = rand(seed);
  const peaks = [
    { x: 260 + r() * 120, y: 190 + r() * 80, levels: 9, base: 26 },
    { x: 780 + r() * 140, y: 420 + r() * 90, levels: 11, base: 24 },
    { x: 560 + r() * 100, y: 80 + r() * 60, levels: 6, base: 22 },
  ];
  const paths: { d: string; major: boolean }[] = [];
  for (const pk of peaks) {
    const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
    const amp = [0.18 + r() * 0.1, 0.1 + r() * 0.08, 0.05 + r() * 0.05];
    for (let l = 1; l <= pk.levels; l++) {
      const rad = pk.base * l;
      const pts: [number, number][] = [];
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wob = 1 + amp[0]! * Math.sin(2 * a + ph[0]! + l * 0.15) + amp[1]! * Math.sin(3 * a + ph[1]!) + amp[2]! * Math.sin(5 * a + ph[2]! - l * 0.2);
        pts.push([pk.x + Math.cos(a) * rad * wob * 1.25, pk.y + Math.sin(a) * rad * wob]);
      }
      paths.push({ d: smoothClosed(pts), major: l % 4 === 0 });
    }
  }
  return paths;
}

const CACHE = new Map<number, ReturnType<typeof terrain>>();

/** Topographic contour lines (decorative SVG, fills its box, slow drift). */
export function TopoLines({ className, seed = 7, drift = true }: { className?: string; seed?: number; drift?: boolean }) {
  let paths = CACHE.get(seed);
  if (!paths) {
    paths = terrain(seed);
    CACHE.set(seed, paths);
  }
  return (
    <svg aria-hidden viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className={cn("lux-sc-scene lux-sc-topo pointer-events-none", className)}>
      <g className={drift ? "lux-sc-topo__drift" : undefined} fill="none" stroke="var(--lux-khaki, var(--foreground))" strokeLinejoin="round">
        {paths.map((p, i) => (
          <path key={i} d={p.d} strokeWidth={p.major ? 1.4 : 0.7} strokeOpacity={p.major ? 0.26 : 0.14} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  );
}
