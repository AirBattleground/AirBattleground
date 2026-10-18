/** Admin training center (phase 2): labelled screenshots used to check the reader (Claude), plus reader status. */
import { Prisma } from "@prisma/client";
import {
  resultsLabelsSchema,
  slotListLabelsSchema,
  type ExtractionResult,
  type ExtractorStatus,
  type ResultsLabels,
  type ScreenshotKind,
  type SlotListLabels,
  type TrainingSampleDetail,
  type TrainingSampleRow,
  type UpdateSampleInput,
} from "@7xen/shared";
import { prisma } from "../db.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { extractor, viaExtractor } from "../lib/extractor.js";
import { datedKey, deleteKey, newFileId, readBuffer, saveBuffer, splitForSha } from "../lib/storage.js";
import type { UploadedImage } from "../lib/upload.js";
import { zodToAppError } from "../lib/validate.js";
import { queueCounts } from "./screenshotWorker.js";
import { labelNameCount } from "./samples.js";

const SAMPLE_NOT_FOUND = "Training sample not found";

const sampleInclude = { createdBy: { select: { id: true, displayName: true } } } satisfies Prisma.TrainingSampleInclude;
type SampleRecord = Prisma.TrainingSampleGetPayload<{ include: typeof sampleInclude }>;

function toRow(s: SampleRecord): TrainingSampleRow {
  return {
    id: s.id,
    kind: s.kind,
    source: s.source,
    split: s.split,
    verified: s.verified,
    excluded: s.excluded,
    nameCount: labelNameCount(s.labels),
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    createdBy: s.createdBy,
  };
}

function toDetail(s: SampleRecord): TrainingSampleDetail {
  return { ...toRow(s), labels: s.labels as unknown as SlotListLabels | ResultsLabels, width: s.width, height: s.height };
}

/** Validate labels against the schema for `kind` (400 with fields under "labels."). */
function parseLabels(kind: ScreenshotKind, labels: unknown): SlotListLabels | ResultsLabels {
  const schema = kind === "SLOT_LIST" ? slotListLabelsSchema : resultsLabelsSchema;
  const r = schema.safeParse(labels);
  if (!r.success) {
    const err = zodToAppError(r.error);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(err.fields ?? {})) fields[`labels.${k}`] = v;
    throw new AppError("VALIDATION_ERROR", kind === "SLOT_LIST" ? "Labels must list teams with slot and players" : "Labels must list rows with rank and players", fields);
  }
  return r.data;
}

async function loadSample(id: string) {
  const s = await prisma.trainingSample.findUnique({ where: { id }, include: sampleInclude });
  if (!s) throw notFound(SAMPLE_NOT_FOUND);
  return s;
}

export async function listSamples(filter: { kind?: ScreenshotKind; split?: "TRAIN" | "TEST"; q?: string }): Promise<TrainingSampleRow[]> {
  const rows = await prisma.trainingSample.findMany({
    where: { ...(filter.kind ? { kind: filter.kind } : {}), ...(filter.split ? { split: filter.split } : {}) },
    include: sampleInclude,
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const q = filter.q?.trim().toLowerCase();
  const matches = q
    ? rows.filter((r) => (r.notes ?? "").toLowerCase().includes(q) || JSON.stringify(r.labels).toLowerCase().includes(q) || r.id === q)
    : rows;
  return matches.map(toRow);
}

export const getSample = async (id: string) => toDetail(await loadSample(id));

export async function sampleFile(id: string) {
  const s = await loadSample(id);
  return { storageKey: s.storageKey, mime: s.storageKey.endsWith(".png") ? "image/png" : s.storageKey.endsWith(".webp") ? "image/webp" : "image/jpeg" };
}

export async function createSample(
  userId: string,
  input: { image: UploadedImage; kind: ScreenshotKind; labels: unknown; split?: "TRAIN" | "TEST"; notes?: string },
): Promise<TrainingSampleRow> {
  const labels = parseLabels(input.kind, input.labels);
  const dup = await prisma.trainingSample.findUnique({ where: { sha256: input.image.sha256 }, select: { id: true } });
  if (dup) throw conflict("This screenshot is already a training sample");
  const key = datedKey("samples", newFileId(), input.image.info.ext);
  await saveBuffer(key, input.image.buffer);
  try {
    const s = await prisma.trainingSample.create({
      data: {
        kind: input.kind,
        source: "ADMIN_UPLOAD",
        storageKey: key,
        sha256: input.image.sha256,
        width: input.image.info.width,
        height: input.image.info.height,
        labels: labels as unknown as Prisma.InputJsonValue,
        split: input.split ?? splitForSha(input.image.sha256),
        // model-prefilled labels are unchecked until the admin verifies them in the label editor
        verified: false,
        notes: input.notes || null,
        createdById: userId,
      },
      include: sampleInclude,
    });
    return toRow(s);
  } catch (e) {
    await deleteKey(key);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("This screenshot is already a training sample");
    throw e;
  }
}

export async function updateSample(id: string, input: UpdateSampleInput): Promise<TrainingSampleDetail> {
  const s = await loadSample(id);
  const data: Prisma.TrainingSampleUpdateInput = {};
  if (input.labels !== undefined) data.labels = parseLabels(s.kind, input.labels) as unknown as Prisma.InputJsonValue;
  if (input.split !== undefined) data.split = input.split;
  if (input.excluded !== undefined) data.excluded = input.excluded;
  if (input.verified !== undefined) data.verified = input.verified;
  if (input.notes !== undefined) data.notes = input.notes || null;
  return toDetail(await prisma.trainingSample.update({ where: { id }, data, include: sampleInclude }));
}

export async function deleteSample(id: string): Promise<void> {
  const s = await loadSample(id);
  await prisma.trainingSample.delete({ where: { id } });
  await deleteKey(s.storageKey);
}

/** Labels from a model reading (the admin then corrects them). */
function labelsFromExtraction(ex: ExtractionResult): SlotListLabels | ResultsLabels {
  const clean = (n: string) => n.trim().slice(0, 40);
  if (ex.kind === "SLOT_LIST") {
    return {
      teams: ex.teams
        .filter((t) => t.slot != null && t.slot >= 1 && t.slot <= 100)
        .map((t) => ({ slot: t.slot!, players: t.players.map((p) => clean(p.rosterMatch ?? p.name)).filter(Boolean).slice(0, 6) }))
        .filter((t) => t.players.length > 0)
        .slice(0, 25),
    };
  }
  const seen = new Set<number>();
  return {
    rows: ex.rows
      .filter((r) => r.rank != null && r.rank >= 1 && r.rank <= 100 && !seen.has(r.rank) && seen.add(r.rank))
      .map((r) => ({
        rank: r.rank!,
        players: r.players
          .map((p) => ({ name: clean(p.rosterMatch ?? p.name), kills: Math.max(0, Math.min(99, p.kills ?? 0)) }))
          .filter((p) => p.name)
          .slice(0, 6),
      }))
      .filter((r) => r.players.length > 0)
      .slice(0, 25),
  };
}

export async function preview(image: UploadedImage, kind: ScreenshotKind): Promise<ExtractionResult> {
  return viaExtractor(() => extractor.extract(image.buffer, image.info.mime, kind, undefined, image.originalName || "image"));
}

export async function prefillSample(id: string): Promise<TrainingSampleDetail> {
  const s = await loadSample(id);
  const buf = await readBuffer(s.storageKey).catch(() => {
    throw notFound("The sample's image file is missing");
  });
  const mime = s.storageKey.endsWith(".png") ? "image/png" : s.storageKey.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const ex = await viaExtractor(() => extractor.extract(buf, mime, s.kind));
  const labels = labelsFromExtraction(ex);
  return toDetail(
    await prisma.trainingSample.update({
      where: { id },
      data: { labels: labels as unknown as Prisma.InputJsonValue, verified: false },
      include: sampleInclude,
    }),
  );
}

// ---------------------------------------------------------------- reader status

export async function extractorStatus(): Promise<ExtractorStatus> {
  const [health, queue] = await Promise.all([
    extractor.status(),
    queueCounts().catch(() => ({ queued: 0, processing: 0, failedLast24h: 0 })),
  ]);
  return { ...health, queue };
}
