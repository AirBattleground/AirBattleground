-- auto screenshot capture from 7XEN Studio → live team status
ALTER TABLE "Match" ADD COLUMN "liveAutoPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Match" ADD COLUMN "liveAutoAt" TIMESTAMP(3);

CREATE TYPE "LiveCaptureStatus" AS ENUM ('QUEUED', 'PROCESSING', 'APPLIED', 'SKIPPED', 'FAILED');

CREATE TABLE "LiveCapture" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "captureId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "sceneId" TEXT,
    "sceneName" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "LiveCaptureStatus" NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "changes" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "LiveCapture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveCapture_workerId_captureId_key" ON "LiveCapture"("workerId", "captureId");
CREATE INDEX "LiveCapture_matchId_capturedAt_idx" ON "LiveCapture"("matchId", "capturedAt");
CREATE INDEX "LiveCapture_status_createdAt_idx" ON "LiveCapture"("status", "createdAt");

ALTER TABLE "LiveCapture" ADD CONSTRAINT "LiveCapture_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
