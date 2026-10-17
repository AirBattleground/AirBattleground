/** Recipe selection (pure, unit tested): a manager's taught version wins over the admin default. */
import type { Recipe, RecipeKey } from "@7xen/shared";

export function pickRecipe(list: Recipe[], key: RecipeKey): Recipe | null {
  const mine = list.filter((r) => r.key === key && r.scope === "MANAGER").sort((a, b) => b.version - a.version)[0];
  if (mine) return mine;
  return list.filter((r) => r.key === key && r.scope === "DEFAULT").sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Steps that need the accessibility service to perform (taps, swipes, typing) in Auto mode. */
export function needsAutomation(r: Recipe | null): boolean {
  return !!r?.steps.some((s) => s.action.type === "tap" || s.action.type === "swipe" || s.action.type === "input_text");
}

export const RECIPE_INFO: Record<RecipeKey, { title: string; text: string }> = {
  CREATE_ROOM: { title: "Create the custom room", text: "From the BGMI lobby: Custom Room → Create → map, mode, slots, password → Create." },
  OPEN_TEAM_LIST: { title: "Open the team list", text: "In the room, open the list of teams/slots so the app can capture it." },
  SCROLL_RESULTS: { title: "Scroll the results", text: "On the results screen, swipe through every page so all teams are captured." },
};
