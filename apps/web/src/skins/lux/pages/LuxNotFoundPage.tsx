import { Link } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { Button } from "@7xen/ui/components/ui/button";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { Crosshair, HudFrame, TacticalBackdrop, ZoneCircle } from "../scenes";

/** Lux 404: "Out of the zone" — same single action as Teal (back home / sign in). */
export default function LuxNotFoundPage({ home, signedIn }: { home: string; signedIn: boolean }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
        <TacticalBackdrop seed={404} />
        <header className="flex items-center justify-between px-4 py-4 sm:px-8 sm:py-5">
          <Link to={home} aria-label="AirBattleground home" className="inline-flex h-9 items-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-11">
            <img src={wordmarkInkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink h-full w-auto dark:hidden" />
            <img src={wordmarkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink hidden h-full w-auto dark:block" />
          </Link>
          <ThemeToggle className="bg-card/70 backdrop-blur" />
        </header>

        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
          <div aria-hidden className="relative mx-auto size-60 sm:size-72">
            <ZoneCircle className="absolute inset-0 size-full" />
            {/* "you" — stranded outside the safe zone */}
            <Crosshair className="absolute bottom-2 left-0 size-16 sm:size-20" />
          </div>
          <p className="lux-sc-eyebrow lux-sc-rise mt-6 font-mono text-primary">Error 404 · Grid unknown</p>
          <h1 className="lux-sc-rise lux-sc-stencil mt-3 font-display text-4xl leading-none sm:text-6xl" style={{ ["--i" as string]: 1 }}>
            Out of the zone
          </h1>
          <p className="lux-sc-rise mx-auto mt-3 max-w-md text-muted-foreground" style={{ ["--i" as string]: 2 }}>
            This page doesn't exist or has moved. The zone is closing — get back to safety.
          </p>
          <HudFrame className="lux-sc-rise mt-8 inline-block" style={{ ["--i" as string]: 3 }}>
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <Link to={home}>
                <ArrowLeft className="size-4" />
                {signedIn ? "Back to base" : "Go to sign in"}
              </Link>
            </Button>
          </HudFrame>
        </main>
      </div>
    </MotionConfig>
  );
}
