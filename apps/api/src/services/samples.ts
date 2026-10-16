/** Training-sample helpers shared by match review (manager corrections) and the admin training center. */
import type { Prisma } from "@prisma/client";
import type { ResultsLabels, ScreenshotKind, SlotListLabels } from "@7xen/shared";
import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { copyKey, datedKey, newFileId, splitForSha } from "../lib/storage.js";

export function labelNameCount(labels: unknown): number {
  const l = (labels ?? {}) as Partial<SlotListLabels & ResultsLabels>;
  if (Array.isArray(l.teams)) return l.teams.reduce((n, t) => n + (Array.isArray(t.players) ? t.players.length : 0), 0);
  if (Array.isArray(l.rows)) return l.rows.reduce((n, r) => n + (Array.isArray(r.players) ? r.players.length : 0), 0);
  return 0;
}

/**
 * Record a manager-confirmed screenshot as a verified training sample (copying the image into samples/).
 * Idempotent by sha256: an existing MANAGER_CORRECTION sample gets its labels refreshed; samples the admin
 * owns (ADMIN_UPLOAD / SEED) are left alone.
 */
export async function upsertCorrectionSample(input: {
  screenshot: { id: string; kind: ScreenshotKind; storageKey: string; sha256: string; width: number | null; height: number | null };
  labels: SlotListLabels | ResultsLabels;
  userId: string;
}): Promise<void> {
  const { screenshot: s, labels } = input;
  if (labelNameCount(labels) === 0) return;
  const existing = await prisma.trainingSample.findUnique({ where: { sha256: s.sha256 } });
  if (existing) {
    if (existing.source === "MANAGER_CORRECTION") {
      await prisma.trainingSample.update({
        where: { id: existing.id },
        data: { labels: labels as unknown as Prisma.InputJsonValue, verified: true, screenshotId: s.id },
      });
    }
    return;
  }
  const ext = s.storageKey.split(".").pop() ?? "jpg";
  const key = datedKey("samples", newFileId(), ext);
  try {
    await copyKey(s.storageKey, key);
  } catch (e) {
    logger.warn({ err: e, screenshotId: s.id }, "could not copy screenshot into training samples");
    return;
  }
  try {
    await prisma.trainingSample.create({
      data: {
        kind: s.kind,
        source: "MANAGER_CORRECTION",
        storageKey: key,
        sha256: s.sha256,
        width: s.width,
        height: s.height,
        labels: labels as unknown as Prisma.InputJsonValue,
        split: splitForSha(s.sha256),
        verified: true,
        screenshotId: s.id,
        createdById: input.userId,
      },
    });
  } catch (e) {
    // a concurrent confirm created it first — fine
    logger.debug({ err: e }, "training sample create skipped");
  }
}
