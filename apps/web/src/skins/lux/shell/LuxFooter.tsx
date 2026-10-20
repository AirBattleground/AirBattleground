import { Link } from "react-router-dom";
import type { NavItem, ShellBrand } from "@/components/shell";

/** Compact site footer: logo + tagline, the nav as text links, copyright. */
export function LuxFooter({ nav, brand, homeHref }: { nav: NavItem[]; brand: ShellBrand; homeHref: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className="lux-sh-footer relative mt-6 border-t bg-card/40 backdrop-blur-md">
      <span aria-hidden className="lux-sh-hazard absolute inset-x-0 -top-px h-[2px] opacity-70" />
      <div className="flex w-full flex-col gap-4 px-4 py-5 sm:px-5 lg:flex-row lg:items-center lg:gap-8 lg:px-6">
        <div className="flex items-center gap-3">
          <Link to={homeHref} aria-label={`${brand.name} home`} className="shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <img src={brand.mark} alt="" className="brand-ink h-8 w-auto" />
          </Link>
          <div className="leading-tight">
            <p className="font-display text-sm tracking-[0.12em] uppercase">Drop in. Lock your slot.</p>
            <p className="text-xs text-muted-foreground">Battlegrounds scrims and tournaments, run simply.</p>
          </div>
        </div>
        <nav aria-label="Footer" className="hidden flex-1 sm:block">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase lg:justify-center">
            {nav.map((n) => (
              <li key={n.key}>
                <Link to={n.to} className="outline-none transition-colors hover:text-primary focus-visible:text-primary">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
          © {year} AirBattleground <span className="text-primary/80">· Grid secure</span>
        </p>
      </div>
    </footer>
  );
}
