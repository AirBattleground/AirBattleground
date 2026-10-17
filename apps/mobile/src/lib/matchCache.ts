/** Last-seen Today cards, so the match screens open instantly; they refresh from the API anyway. */
import type { LiveMatchCard } from "@7xen/shared";

const cards = new Map<string, LiveMatchCard>();
export const matchCache = {
  setAll(list: LiveMatchCard[]) {
    for (const c of list) cards.set(c.matchId, c);
  },
  get(id: string) {
    return cards.get(id) ?? null;
  },
  set(c: LiveMatchCard) {
    cards.set(c.matchId, c);
  },
};
