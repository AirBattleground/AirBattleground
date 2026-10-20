/**
 * Site look ("skin") of the web portal (team + manager). Same pages and features, different UI:
 *   teal — "Teal Battle": the original sidebar app look.
 *   lux  — "Lux Battle": branded-site look (top navigation, military-tactical graphics, heavy animation).
 * The admin picks one for everyone; stored in AppSetting "uiSkin". Default "teal".
 *
 * PUBLIC (no sign-in — the login page is skinned too)
 *   GET /api/site/skin                          → UiSkinResponse
 * ADMIN (role ADMIN)
 *   PUT /api/admin/site/skin   UpdateUiSkinInput → UiSkinResponse
 *
 * Web: `?skin=teal|lux` in the URL previews a skin in that browser tab only (not saved).
 */
import { z } from "zod";

export const UI_SKINS = ["teal", "lux"] as const;
export type UiSkin = (typeof UI_SKINS)[number];
export const DEFAULT_UI_SKIN: UiSkin = "teal";

export const UI_SKIN_LABELS: Record<UiSkin, { name: string; description: string }> = {
  teal: { name: "Teal Battle", description: "Clean app look with a side menu. Calm and simple." },
  lux: { name: "Lux Battle", description: "Branded esports site: top menu, tactical graphics and lots of animation." },
};

export const updateUiSkinSchema = z.object({ skin: z.enum(UI_SKINS, { errorMap: () => ({ message: "Pick a look" }) }) });
export type UpdateUiSkinInput = z.infer<typeof updateUiSkinSchema>;

export interface UiSkinResponse {
  skin: UiSkin;
}

export const isUiSkin = (v: unknown): v is UiSkin => typeof v === "string" && (UI_SKINS as readonly string[]).includes(v);
