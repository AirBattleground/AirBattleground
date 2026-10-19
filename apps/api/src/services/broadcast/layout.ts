/** Phase 6b: a manager's broadcast layout (one per manager), sponsor logos and stream destinations. */
import {
  DEFAULT_STREAM_LAYOUT,
  DESTINATION_PRESETS,
  MAX_DESTINATIONS,
  MAX_SPONSOR_LOGOS,
  streamLayoutSchema,
  type DestinationKind,
  type SponsorLogo,
  type StreamDestinationInput,
  type StreamDestinationRow,
  type StreamDestinationUpdate,
  type StreamLayoutConfig,
  type StreamLayoutResponse,
} from "@7xen/shared";
import type { Prisma, StreamDestination } from "@prisma/client";
import { prisma } from "../../db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/secretBox.js";
import { brandingUrl } from "../../lib/serialize.js";
import { deleteKey, resolveKey } from "../../lib/storage.js";
import type { UploadedImage } from "../../lib/upload.js";
import { store } from "../branding.js";

type StoredSponsor = { id: string; key: string };

/** Stored JSON → full config (older rows may miss newer fields; anything invalid falls back to the default). */
function toConfig(raw: Prisma.JsonValue | null | undefined): StreamLayoutConfig {
  const base = DEFAULT_STREAM_LAYOUT;
  const r = (raw ?? {}) as Partial<StreamLayoutConfig>;
  const merged = {
    ...base,
    ...r,
    titleBar: { ...base.titleBar, ...(r.titleBar ?? {}) },
    teams: { ...base.teams, ...(r.teams ?? {}) },
    points: { ...base.points, ...(r.points ?? {}) },
    ticker: { ...base.ticker, ...(r.ticker ?? {}) },
    sponsors: { ...base.sponsors, ...(r.sponsors ?? {}) },
    socials: { ...base.socials, ...(r.socials ?? {}) },
  };
  const ok = streamLayoutSchema.safeParse(merged);
  return ok.success ? ok.data : base;
}

const sponsorsOf = (raw: Prisma.JsonValue | null | undefined): StoredSponsor[] => (Array.isArray(raw) ? (raw as StoredSponsor[]) : []);

export async function loadLayout(managerId: string): Promise<{ config: StreamLayoutConfig; sponsors: StoredSponsor[]; updatedAt: Date | null }> {
  const row = await prisma.streamLayout.findUnique({ where: { managerId } });
  return { config: toConfig(row?.config), sponsors: sponsorsOf(row?.sponsors), updatedAt: row?.updatedAt ?? null };
}

/** Absolute paths of the sponsor logos the layout shows, in its order. */
export function sponsorPaths(config: StreamLayoutConfig, sponsors: StoredSponsor[]): string[] {
  const byId = new Map(sponsors.map((s) => [s.id, s.key]));
  return config.sponsors.logoIds.flatMap((id) => {
    const key = byId.get(id);
    if (!key) return [];
    try {
      return [resolveKey(key)];
    } catch {
      return [];
    }
  });
}

function toResponse(l: Awaited<ReturnType<typeof loadLayout>>): StreamLayoutResponse {
  return {
    config: l.config,
    sponsors: l.sponsors.map((s): SponsorLogo => ({ id: s.id, url: brandingUrl(s.key)! })),
    updatedAt: l.updatedAt?.toISOString() ?? null,
  };
}

export async function getLayout(managerId: string): Promise<StreamLayoutResponse> {
  return toResponse(await loadLayout(managerId));
}

export async function saveLayout(managerId: string, config: StreamLayoutConfig): Promise<StreamLayoutResponse> {
  const { sponsors } = await loadLayout(managerId);
  const known = new Set(sponsors.map((s) => s.id));
  const clean = { ...config, sponsors: { ...config.sponsors, logoIds: config.sponsors.logoIds.filter((id) => known.has(id)) } };
  await prisma.streamLayout.upsert({
    where: { managerId },
    create: { managerId, config: clean as unknown as Prisma.InputJsonValue },
    update: { config: clean as unknown as Prisma.InputJsonValue },
  });
  return getLayout(managerId);
}

export async function addSponsor(managerId: string, img: UploadedImage): Promise<SponsorLogo> {
  if (img.info.ext === "webp") throw new AppError("VALIDATION_ERROR", "Use a PNG or JPG logo", { image: "PNG or JPG only" });
  const l = await loadLayout(managerId);
  if (l.sponsors.length >= MAX_SPONSOR_LOGOS) throw conflict(`You can keep up to ${MAX_SPONSOR_LOGOS} sponsor logos. Remove one first.`);
  const key = await store(img);
  const s = { id: key.split("/")[1]!.split(".")[0]!.slice(0, 12), key };
  const sponsors = [...l.sponsors, s];
  // a new logo is shown straight away (appended to the layout's order)
  const config = { ...l.config, sponsors: { ...l.config.sponsors, logoIds: [...l.config.sponsors.logoIds, s.id].slice(0, MAX_SPONSOR_LOGOS) } };
  await prisma.streamLayout.upsert({
    where: { managerId },
    create: { managerId, config: config as unknown as Prisma.InputJsonValue, sponsors: sponsors as unknown as Prisma.InputJsonValue },
    update: { config: config as unknown as Prisma.InputJsonValue, sponsors: sponsors as unknown as Prisma.InputJsonValue },
  });
  return { id: s.id, url: brandingUrl(key)! };
}

export async function removeSponsor(managerId: string, id: string): Promise<void> {
  const l = await loadLayout(managerId);
  const s = l.sponsors.find((x) => x.id === id);
  if (!s) throw notFound("Logo not found");
  const config = { ...l.config, sponsors: { ...l.config.sponsors, logoIds: l.config.sponsors.logoIds.filter((x) => x !== id) } };
  await prisma.streamLayout.update({
    where: { managerId },
    data: { config: config as unknown as Prisma.InputJsonValue, sponsors: l.sponsors.filter((x) => x.id !== id) as unknown as Prisma.InputJsonValue },
  });
  await deleteKey(s.key);
}

// ---------------------------------------------------------------- destinations

const hint = (key: string) => `${key.slice(0, 4)}••••`;

function toDestRow(d: StreamDestination): StreamDestinationRow {
  return { id: d.id, kind: (d.kind in DESTINATION_PRESETS ? d.kind : "CUSTOM") as DestinationKind, name: d.name, url: d.url, keyHint: d.keyHint, createdAt: d.createdAt.toISOString() };
}

export async function listDestinations(managerId: string): Promise<StreamDestinationRow[]> {
  return (await prisma.streamDestination.findMany({ where: { managerId }, orderBy: { createdAt: "asc" } })).map(toDestRow);
}

export async function createDestination(managerId: string, input: StreamDestinationInput): Promise<StreamDestinationRow> {
  if ((await prisma.streamDestination.count({ where: { managerId } })) >= MAX_DESTINATIONS) throw conflict(`You can save up to ${MAX_DESTINATIONS} destinations.`);
  const d = await prisma.streamDestination.create({
    data: { managerId, kind: input.kind, name: input.name, url: input.url.replace(/\/+$/, ""), keyEnc: encryptSecret(input.streamKey), keyHint: hint(input.streamKey) },
  });
  return toDestRow(d);
}

async function ownDest(id: string, managerId: string) {
  const d = await prisma.streamDestination.findUnique({ where: { id } });
  if (!d || d.managerId !== managerId) throw notFound("Destination not found");
  return d;
}

export async function updateDestination(managerId: string, id: string, input: StreamDestinationUpdate): Promise<StreamDestinationRow> {
  await ownDest(id, managerId);
  const d = await prisma.streamDestination.update({
    where: { id },
    data: {
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.url ? { url: input.url.replace(/\/+$/, "") } : {}),
      ...(input.streamKey ? { keyEnc: encryptSecret(input.streamKey), keyHint: hint(input.streamKey) } : {}),
    },
  });
  return toDestRow(d);
}

export async function deleteDestination(managerId: string, id: string): Promise<void> {
  await ownDest(id, managerId);
  await prisma.streamDestination.delete({ where: { id } });
}

/** Full push URLs (url + "/" + key) for the compositor, in the given order; unknown ids are skipped. */
export async function destinationTargets(managerId: string, ids: string[]): Promise<{ id: string; name: string; kind: DestinationKind; target: string }[]> {
  const rows = await prisma.streamDestination.findMany({ where: { managerId, id: { in: ids } } });
  return rows.map((d) => ({ id: d.id, name: d.name, kind: toDestRow(d).kind, target: `${d.url}/${decryptSecret(d.keyEnc)}` }));
}
