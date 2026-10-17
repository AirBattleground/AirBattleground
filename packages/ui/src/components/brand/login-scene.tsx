import { useCallback, useMemo, useRef, type PointerEvent, type ReactNode } from "react";
import { cn } from "@7xen/ui/lib/utils";
import mapUrl from "../../assets/login/erangel.webp";
import squadUrl from "../../assets/login/squad.webp";

/**
 * Sign-in layout with the Erangel map + squad artwork blending into the form panel
 * (design: downloads/slot-table-final, "SLOT / TABLE — Final Edition"). Styles: styles/login-scene.css.
 *
 * <LoginScene header={<Logo/>…} footer={…}>{form}</LoginScene>
 * The scene is decorative (aria-hidden); the form panel is the page's main landmark.
 */
export function LoginScene({ header, footer, children, className }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  const portal = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  // gentle pointer depth on the squad (mouse/pen only; CSS disables it for reduced motion)
  const onMove = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch" || !portal.current) return;
    cancelAnimationFrame(frame.current);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    frame.current = requestAnimationFrame(() => {
      portal.current?.style.setProperty("--mx", `${((x - rect.left) / rect.width - 0.5) * -4}px`);
      portal.current?.style.setProperty("--my", `${((y - rect.top) / rect.height - 0.5) * -3}px`);
    });
  }, []);
  const onLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    portal.current?.style.setProperty("--mx", "0px");
    portal.current?.style.setProperty("--my", "0px");
  }, []);

  // floating dust motes over the map (deterministic positions so SSR/hydration and re-renders are stable)
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const r = (n: number) => ((Math.sin((i + 1) * 9301 + n * 49297) * 233280) % 1 + 1) % 1;
        return { left: `${(r(1) * 95).toFixed(1)}%`, top: `${(35 + r(2) * 60).toFixed(1)}%`, duration: `${(9 + r(3) * 9).toFixed(1)}s`, delay: `${(-r(4) * 14).toFixed(1)}s` };
      }),
    [],
  );

  return (
    <div className={cn("ls-shell", className)}>
      <SquadMatte />
      <div ref={portal} className="ls-portal">
        <div className="ls-scene" aria-hidden>
          <div className="ls-map-window">
            <img className="ls-map" src={mapUrl} alt="" width={1600} height={900} decoding="async" />
          </div>
          <div className="ls-map-tone" />
          <img
            className="ls-squad"
            src={squadUrl}
            alt=""
            width={1448}
            height={1086}
            fetchPriority="high"
            style={{ mask: "url(#ls-squad-matte)", maskMode: "luminance" } as React.CSSProperties}
          />
          <div className="ls-shade" />
          <div className="ls-light" />
          <div className="ls-atmosphere">
            {motes.map((m, i) => (
              <span key={i} className="ls-mote" style={{ left: m.left, top: m.top, "--duration": m.duration, "--delay": m.delay } as React.CSSProperties} />
            ))}
          </div>
          <div className="ls-grain" />
        </div>

        {header && <div className="ls-header">{header}</div>}

        <div className="ls-grid">
          <section className="ls-hero" aria-hidden onPointerMove={onMove} onPointerLeave={onLeave} />
          <main className="ls-pane">
            <div className="ls-content">{children}</div>
          </main>
        </div>
        {footer && <div className="ls-footer">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Luminance mask that cleans the pale matte fringe around the central characters (from the design's
 * SVG definitions; coordinates are in the artwork's 1448×1086 pixel space).
 */
function SquadMatte() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <defs>
        <filter id="ls-matte-alpha" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncA type="linear" slope={127.5} intercept={-125.5} />
          </feComponentTransfer>
          <feMorphology operator="dilate" radius={1.2} />
          <feMorphology operator="erode" radius={1.2} />
          <feGaussianBlur stdDeviation={1.4} />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>
        <linearGradient id="ls-matte-transition" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity={0} />
          <stop offset="1" stopColor="white" />
        </linearGradient>
        <clipPath id="ls-upper-edge">
          <path d="M656 218 710 226 795 260 795 323 783 376 794 425 801 482 736 507 710 458 690 402 686 348 669 299Z" />
          <path d="M880 254 925 272 952 301 982 327 1013 379 1015 447 989 481 961 444 945 403 918 367 894 331 875 295Z" />
          <path d="M710 415 763 423 801 458 795 500 748 510 708 471Z" />
        </clipPath>
        <mask id="ls-squad-matte" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1" style={{ maskType: "luminance" }}>
          <g transform="scale(0.0006906077348066298 0.0009208103130755064)">
            <rect width="1448" height="1086" fill="white" />
            <g clipPath="url(#ls-upper-edge)">
              <rect width="1448" height="550" fill="black" />
              <image href={squadUrl} width="1448" height="1086" preserveAspectRatio="none" filter="url(#ls-matte-alpha)" />
              <rect y="490" width="1448" height="60" fill="url(#ls-matte-transition)" />
            </g>
            <g fill="white">
              <path d="M250 370 326 368 585 647 738 854 732 883 555 733 447 653 358 599 332 547 278 452Z" />
              <path d="M506 350 614 380 804 603 798 636 675 541 616 511 573 516 548 456 502 402Z" />
              <path d="M790 365 860 390 1010 505 1002 552 955 545 922 594 866 582 877 531 808 464 777 419Z" />
              <path d="M1022 282 1101 289 1254 397 1380 480 1448 566 1448 617 1378 579 1274 518 1206 542 1156 522 1167 460 1093 388 1013 347Z" />
            </g>
          </g>
        </mask>
      </defs>
    </svg>
  );
}
