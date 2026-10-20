import { useEffect, useState } from "react";
import { motion, MotionConfig } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@7xen/ui/components/brand/theme-toggle";
import { SignIn, WatchLiveLink, type OnSignedIn } from "@/pages/auth/LoginPage";
import { WelcomeHeading } from "@/pages/auth/WelcomeHeading";
import wordmarkUrl from "@/assets/brand/airbattleground-wordmark.webp";
import wordmarkInkUrl from "@/assets/brand/airbattleground-wordmark-ink.webp";
import { AircraftFlyover, Crosshair, HudFrame, ParachuteDrop, RadarScope, TacticalBackdrop, Ticker, ZoneCircle } from "../scenes";

const EASE = [0.16, 1, 0.3, 1] as const;

const STEPS = [
  { n: "01", label: "Find a scrim" },
  { n: "02", label: "Get your slot" },
  { n: "03", label: "Drop in" },
];

const TICKER = [
  "Scrims every day",
  "Register in one tap",
  "Slot given when approved",
  "Room ID before the match",
  "Results & points tables",
  "Tournaments open",
];

/** Live IST clock for the HUD strip (minute resolution). */
function useIstClock() {
  const fmt = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date());
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = window.setInterval(() => setT(fmt()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return t;
}

/** Full-bleed tactical scene behind the page: map table, flight over it dropping chutes, the zone and a radar. */
function LoginScene() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <TacticalBackdrop seed={11} />
      {/* zone + crosshair cluster on the right (behind the card on desktop, top-right on phones) */}
      <div className="lux-sc-login-zone absolute top-[4%] -right-[30%] w-[115vw] max-w-[760px] opacity-60 sm:-right-[12%] sm:w-[80vw] lg:top-[8%] lg:right-[2%] lg:w-[52vw] lg:opacity-80">
        <ZoneCircle className="size-full" />
      </div>
      <Crosshair className="absolute top-[30%] left-[58%] hidden size-24 opacity-50 lg:block" />
      <AircraftFlyover top="15%" angle={-7} duration={18} size={150} className="hidden sm:block" />
      <AircraftFlyover top="11%" angle={-9} duration={13} size={96} className="sm:hidden" />
      <ParachuteDrop count={7} className="top-[12%] hidden sm:block" fall={1.3} />
      <ParachuteDrop count={4} className="top-[10%] sm:hidden" fall={0.8} />
      <RadarScope className="absolute bottom-24 left-6 hidden w-36 opacity-70 xl:block" />
    </div>
  );
}

/** Lux Battle sign-in: cinematic drop-zone landing with the same sign-in, tour targets and redirects as Teal. */
export default function LuxLoginPage({ onSignedIn }: { onSignedIn: OnSignedIn }) {
  const clock = useIstClock();
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
        <LoginScene />

        <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
          <span className="inline-flex h-9 items-center sm:h-11">
            <img src={wordmarkInkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink h-full w-auto dark:hidden" />
            <img src={wordmarkUrl} alt="AirBattleground" width={900} height={252} className="brand-ink hidden h-full w-auto dark:block" />
          </span>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 border bg-card/60 px-2.5 py-1 font-mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase backdrop-blur sm:inline-flex">
              <span className="lux-sc-live-dot" aria-hidden /> IST {clock}
            </span>
            <ThemeToggle className="bg-card/70 backdrop-blur" />
          </div>
        </header>

        <main className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-8 px-4 pt-2 pb-10 sm:px-8 lg:grid-cols-[1.15fr_minmax(0,440px)] lg:gap-14 lg:pb-16">
          {/* headline */}
          <section className="min-w-0">
            <p className="lux-sc-eyebrow lux-sc-rise flex items-center gap-2.5 font-mono text-primary">
              <span className="lux-sc-hazard h-2.5 w-8" aria-hidden /> Drop zone · Open
            </p>
            <h2 className="lux-sc-rise lux-sc-stencil mt-4 font-display text-[2.6rem] leading-[0.95] sm:text-6xl xl:text-7xl" style={{ ["--i" as string]: 1 }}>
              Squad up.
              <br />
              <span className="text-primary">Win the zone.</span>
            </h2>
            <p className="lux-sc-rise mt-4 max-w-md text-lg font-medium sm:text-xl" style={{ ["--i" as string]: 2 }}>
              Find scrims. Get your slot. Drop in.
            </p>
            <ol className="lux-sc-rise mt-6 hidden max-w-lg grid-cols-3 gap-2 sm:grid" style={{ ["--i" as string]: 3 }}>
              {STEPS.map((s) => (
                <li key={s.n} className="border bg-card/55 px-3 py-2.5 backdrop-blur">
                  <span className="block font-mono text-xs tracking-[0.2em] text-primary">{s.n}</span>
                  <span className="mt-0.5 block text-sm font-semibold">{s.label}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* sign-in card */}
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.15 }} className="w-full">
            <HudFrame label="Sign in" serial="AB-01" className="w-full">
              <div className="relative overflow-hidden border bg-card/85 p-5 shadow-2xl backdrop-blur-md sm:p-7">
                <WelcomeHeading className="text-3xl sm:text-4xl" />
                <p className="mt-3 text-sm text-muted-foreground">Players, organisers and admins — one sign-in.</p>
                <div className="lux-sc-signin mt-6">
                  <SignIn onSignedIn={onSignedIn} />
                </div>
                <WatchLiveLink className="mt-5" />
                <ul className="mt-6 grid gap-2 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <ArrowRight className="size-3.5 text-primary" /> Players go to their team
                  </li>
                  <li className="flex items-center gap-2">
                    <ArrowRight className="size-3.5 text-primary" /> Invited organisers go to their dashboard
                  </li>
                </ul>
                <p className="mt-6 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4 text-primary" /> Your account. Your game.
                </p>
              </div>
            </HudFrame>
          </motion.div>
        </main>

        <footer className="relative z-10 border-t bg-background/70 backdrop-blur">
          <Ticker items={TICKER} className="py-2.5 text-muted-foreground" speed={36} />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t px-4 py-3 font-mono text-[11px] tracking-[0.15em] text-muted-foreground uppercase sm:px-8">
            <span>© {new Date().getFullYear()} AirBattleground</span>
            <span className="hidden sm:inline">Made for the game. Built for the players.</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="lux-sc-live-dot" aria-hidden /> Scrims · Tournaments
            </span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
