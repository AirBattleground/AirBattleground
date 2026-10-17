/**
 * The GameOps native module (apps/mobile/modules/gameops, Kotlin) — or an in-JS mock when the native
 * module isn't part of this build, or when EXPO_PUBLIC_GAMEOPS_MOCK=1.
 */
import { useEffect, useRef } from "react";
import { requireOptionalNativeModule } from "expo";
import { createGameOpsMock } from "./gameops-mock";
import type { GameOpsEventName, GameOpsEvents, GameOpsModule, Subscription } from "./types";

type WithEvents = GameOpsModule & {
  addListener<K extends GameOpsEventName>(name: K, cb: (e: GameOpsEvents[K]) => void): Subscription;
};

const forceMock = process.env.EXPO_PUBLIC_GAMEOPS_MOCK === "1";
const native = forceMock ? null : requireOptionalNativeModule<WithEvents>("GameOps");

/** true when the real recorder isn't available (UI shows a "demo mode" note). */
export const GAMEOPS_IS_MOCK = native == null;
export const GameOps: WithEvents = native ?? createGameOpsMock();

/** Subscribe to a GameOps event for the lifetime of the component. */
export function useGameOpsEvent<K extends GameOpsEventName>(name: K, cb: (e: GameOpsEvents[K]) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const sub = GameOps.addListener(name, (e) => ref.current(e));
    return () => sub.remove();
  }, [name]);
}
