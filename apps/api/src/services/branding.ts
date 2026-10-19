/**
 * Branding images: a manager's organisation logo, scrim posters and tournament posters.
 * Stored under STORAGE_DIR as "branding/<random id>.<ext>" and served to any signed-in user via
 * GET /api/media/branding/:file. Replacing or removing an image deletes the old file.
 */
import { MAX_BRANDING_IMAGE_BYTES, type ImageUrlResponse } from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, notFound } from "../lib/errors.js";
import { brandingUrl } from "../lib/serialize.js";
import { deleteKey, newFileId, saveBuffer } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import type { Actor } from "./tournaments/core.js";

const MB = Math.round(MAX_BRANDING_IMAGE_BYTES / (1024 * 1024));
const FILE_RE = /^[a-f0-9]{32}\.(png|jpg|webp)$/;
const MIME_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** "<id>.png" from the media route → storage key + mime, or 404. */
export function brandingFile(file: string): { key: string; mime: string } {
  if (!FILE_RE.test(file)) throw notFound("Image not found");
  return { key: `branding/${file}`, mime: MIME_BY_EXT[file.split(".")[1]!]! };
}

/** Save a branding image (size-checked) → its storage key. Also used for broadcast sponsor logos (phase 6b). */
export async function store(img: UploadedImage): Promise<string> {
  if (img.buffer.length > MAX_BRANDING_IMAGE_BYTES) {
    throw new AppError("VALIDATION_ERROR", `The image must be ${MB} MB or smaller`, { file: `Max ${MB} MB` }, 413);
  }
  const key = `branding/${newFileId()}.${img.info.ext}`;
  await saveBuffer(key, img.buffer);
  return key;
}

/** Save the new image, point the row at it, then drop the old file. */
async function swap(oldKey: string | null, img: UploadedImage | null, write: (key: string | null) => Promise<unknown>): Promise<ImageUrlResponse> {
  const key = img ? await store(img) : null;
  try {
    await write(key);
  } catch (e) {
    if (key) await deleteKey(key);
    throw e;
  }
  if (oldKey && oldKey !== key) await deleteKey(oldKey);
  return { url: brandingUrl(key) };
}

// ---------------------------------------------------------------- org logo

export async function getOrgLogo(managerId: string): Promise<ImageUrlResponse> {
  const u = await prisma.user.findUnique({ where: { id: managerId }, select: { orgLogoKey: true } });
  return { url: brandingUrl(u?.orgLogoKey) };
}

export async function setOrgLogo(managerId: string, img: UploadedImage | null): Promise<ImageUrlResponse> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: managerId }, select: { orgLogoKey: true } });
  return swap(u.orgLogoKey, img, (orgLogoKey) => prisma.user.update({ where: { id: managerId }, data: { orgLogoKey } }));
}

// ---------------------------------------------------------------- scrim poster

export async function setScrimPoster(scrimId: string, managerId: string, img: UploadedImage | null): Promise<ImageUrlResponse> {
  const s = await prisma.scrim.findFirst({ where: { id: scrimId, managerId }, select: { posterKey: true } });
  if (!s) throw notFound("Scrim not found");
  return swap(s.posterKey, img, (posterKey) => prisma.scrim.update({ where: { id: scrimId }, data: { posterKey } }));
}

// ---------------------------------------------------------------- tournament poster

export async function setTournamentPoster(tournamentId: string, actor: Actor, img: UploadedImage | null): Promise<ImageUrlResponse> {
  const t = await prisma.tournament.findFirst({
    where: { id: tournamentId, ...(actor.admin ? {} : { managerId: actor.userId }) },
    select: { posterKey: true },
  });
  if (!t) throw notFound("Tournament not found");
  return swap(t.posterKey, img, (posterKey) => prisma.tournament.update({ where: { id: tournamentId }, data: { posterKey } }));
}

// ---------------------------------------------------------------- team logo (player teams)

export async function setTeamLogo(teamId: string, img: UploadedImage | null): Promise<ImageUrlResponse> {
  const t = await prisma.team.findUnique({ where: { id: teamId }, select: { logoKey: true } });
  if (!t) throw notFound("Team not found");
  return swap(t.logoKey, img, (logoKey) => prisma.team.update({ where: { id: teamId }, data: { logoKey } }));
}
