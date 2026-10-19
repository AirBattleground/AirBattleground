import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LoginScene } from "@7xen/ui/components/brand/login-scene";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import markUrl from "@/assets/brand/airbattleground-mark.webp";

/** The sign-in artwork layout, reused for onboarding (/welcome) and invite links (/join/:code). */
export function PlayerScene({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="bg-background">
      <LoginScene
        header={
          <>
            <Link to="/" aria-label="AirBattleground home" className="block rounded-lg outline-none drop-shadow-[0_2px_12px_rgb(0_0_0/0.5)] focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <picture className="block">
                <source media="(max-width: 850px)" srcSet={markUrl} />
                <img src={wordmarkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink h-12 w-auto max-[850px]:h-14 sm:h-14 min-[1200px]:h-16" />
              </picture>
            </Link>
            {aside}
          </>
        }
        footer={
          <>
            <span>© {new Date().getFullYear()} AirBattleground</span>
            <span>Made for the game. Built for the players.</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-primary shadow-glow" /> Scrims · Tournaments
            </span>
          </>
        }
      >
        {children}
      </LoginScene>
    </div>
  );
}

export function SceneEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.25em] text-primary uppercase">
      <span className="h-px w-6 bg-primary" /> {children}
    </p>
  );
}
