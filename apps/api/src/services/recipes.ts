/**
 * Phase 4: recipes — the touch-step checklists the manager app follows in BGMI (assisted or automatic).
 * Admin-maintained DEFAULT versions (managerId null) + per-manager versions taught on a device.
 * Managers get the defaults merged with their own (their version wins per key).
 */
import type { Prisma, Recipe as DbRecipe } from "@prisma/client";
import { RECIPE_KEYS, recipeStepSchema, type Recipe, type RecipeKey, type RecipeStep, type SaveRecipeInput } from "@7xen/shared";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError, notFound } from "../lib/errors.js";

const stepsSchema = z.array(recipeStepSchema);

function toRecipe(r: DbRecipe & { manager?: { id: string; displayName: string } | null }): Recipe {
  const parsed = stepsSchema.safeParse(r.steps);
  return {
    id: r.id,
    key: r.key as RecipeKey,
    name: r.name,
    version: r.version,
    scope: r.managerId ? "MANAGER" : "DEFAULT",
    deviceProfile: r.deviceProfile,
    steps: parsed.success ? parsed.data : [],
    updatedAt: r.updatedAt.toISOString(),
    ...(r.manager !== undefined ? { manager: r.manager } : {}),
  };
}

export function parseRecipeKey(key: string): RecipeKey {
  if (!(RECIPE_KEYS as readonly string[]).includes(key)) {
    throw new AppError("VALIDATION_ERROR", `Unknown recipe. Use one of: ${RECIPE_KEYS.join(", ")}`);
  }
  return key as RecipeKey;
}

const keyOrder = (k: string) => (RECIPE_KEYS as readonly string[]).indexOf(k);

/** Defaults merged with the manager's own versions (manager's wins per key). */
export async function managerRecipes(managerId: string): Promise<Recipe[]> {
  const rows = await prisma.recipe.findMany({ where: { OR: [{ managerId: null }, { managerId }] } });
  const byKey = new Map<string, DbRecipe>();
  for (const r of rows) {
    const cur = byKey.get(r.key);
    if (!cur || (r.managerId && !cur.managerId)) byKey.set(r.key, r);
  }
  return [...byKey.values()].sort((a, b) => keyOrder(a.key) - keyOrder(b.key)).map(toRecipe);
}

/** Upsert a recipe for `managerId` (null = the admin default); bumps the version. */
export async function saveRecipe(key: RecipeKey, managerId: string | null, input: SaveRecipeInput): Promise<Recipe> {
  const data = {
    name: input.name,
    steps: input.steps as unknown as Prisma.InputJsonValue,
    ...(input.deviceProfile !== undefined ? { deviceProfile: input.deviceProfile } : {}),
  };
  // (key, managerId) is unique, but NULL managerIds aren't — so find-then-write instead of upsert
  const existing = await prisma.recipe.findFirst({ where: { key, managerId } });
  const row = existing
    ? await prisma.recipe.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
    : await prisma.recipe.create({ data: { key, managerId, ...data } });
  return toRecipe(row);
}

export async function adminRecipes(): Promise<Recipe[]> {
  const rows = await prisma.recipe.findMany({ include: { manager: { select: { id: true, displayName: true } } } });
  return rows
    .sort((a, b) => keyOrder(a.key) - keyOrder(b.key) || Number(!!a.managerId) - Number(!!b.managerId) || (a.manager?.displayName ?? "").localeCompare(b.manager?.displayName ?? ""))
    .map(toRecipe);
}

export async function deleteRecipe(id: string): Promise<void> {
  const r = await prisma.recipe.findUnique({ where: { id } });
  if (!r) throw notFound("Recipe not found");
  await prisma.recipe.delete({ where: { id } });
}

// ---------------------------------------------------------------- built-in defaults

const manual = { type: "manual" as const };
const step = (id: string, label: string, hint: string, timeoutMs = 60_000): RecipeStep => ({ id, label, hint, action: manual, timeoutMs });

/**
 * Assisted checklists (no coordinates: those come from teach mode on a real device).
 * Exported for the seed script and tests.
 */
export const DEFAULT_RECIPES: { key: RecipeKey; name: string; steps: RecipeStep[] }[] = [
  {
    key: "CREATE_ROOM",
    name: "Create custom room",
    steps: [
      step("open_bgmi", "Open BGMI", "Wait for the lobby to load."),
      step("open_room_menu", "Open Custom Room", "Lobby → mode selection → Room (Custom Room)."),
      step("create_room", "Tap Create", "Create a new room with your host account."),
      step("pick_map", "Choose the map", "Pick the map shown for this match in AirBattleground."),
      step("set_mode", "Set mode & perspective", "Squad, TPP (or as your rules say)."),
      step("set_slots", "Set team slots", "Match the slot range shown in AirBattleground (e.g. slots 3–20)."),
      step("set_password", "Set the room password", "Type the password you'll share with teams."),
      step("confirm_room", "Create the room", "Confirm and wait for the room screen."),
      step("save_room", "Send Room ID to AirBattleground", "Read the Room ID + password and save them in the app — teams see them at reveal time."),
    ],
  },
  {
    key: "OPEN_TEAM_LIST",
    name: "Capture the team list",
    steps: [
      step("open_room", "Open the room lobby", "Go to the custom room screen where teams join."),
      step("open_team_list", "Open the team list", "Show every slot with player names."),
      step("capture_top", "Capture the first page", "The app captures automatically when it sees the list (or tap Capture)."),
      step("scroll_list", "Scroll to the next teams", "Swipe up slowly until new slots show; repeat until the last slot."),
      step("done_list", "Done", "Check every slot was captured before starting the match."),
    ],
  },
  {
    key: "SCROLL_RESULTS",
    name: "Capture the results",
    steps: [
      step("wait_results", "Wait for the results screen", "After the match ends, open the final standings/results.", 300_000),
      step("capture_first", "Capture the top ranks", "The app captures automatically when it sees the results (or tap Capture)."),
      step("scroll_results", "Scroll the results", "Swipe up slowly; each new position is captured. Duplicates are dropped."),
      step("done_results", "Done", "Stop when the last rank is visible, then stop the recording."),
    ],
  },
];

/** Create the built-in DEFAULT recipes that don't exist yet (never overwrites admin edits). */
export async function ensureDefaultRecipes(db: Pick<typeof prisma, "recipe"> = prisma): Promise<number> {
  let created = 0;
  for (const r of DEFAULT_RECIPES) {
    const existing = await db.recipe.findFirst({ where: { key: r.key, managerId: null }, select: { id: true } });
    if (existing) continue;
    await db.recipe.create({ data: { key: r.key, name: r.name, managerId: null, steps: r.steps as unknown as Prisma.InputJsonValue } });
    created++;
  }
  return created;
}
