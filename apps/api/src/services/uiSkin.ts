/** Site look of the web portal (teal | lux), picked by the admin. AppSetting "uiSkin". See @7xen/shared skin.ts. */
import { DEFAULT_UI_SKIN, isUiSkin, type UiSkinResponse, type UpdateUiSkinInput } from "@7xen/shared";
import { prisma } from "../db.js";

const KEY = "uiSkin";

export async function getUiSkin(): Promise<UiSkinResponse> {
  const s = await prisma.appSetting.findUnique({ where: { key: KEY } });
  return { skin: isUiSkin(s?.value) ? s.value : DEFAULT_UI_SKIN };
}

export async function setUiSkin({ skin }: UpdateUiSkinInput): Promise<UiSkinResponse> {
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: skin }, update: { value: skin } });
  return { skin };
}
