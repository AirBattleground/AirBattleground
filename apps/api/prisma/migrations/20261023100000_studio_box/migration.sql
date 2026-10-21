-- Phase 8c: Studio Box — what a box reports in its worker poll (null = a plain Studio worker)
ALTER TABLE "StudioWorker" ADD COLUMN "boxLanUrl" TEXT;
ALTER TABLE "StudioWorker" ADD COLUMN "boxDevices" INTEGER;
ALTER TABLE "StudioWorker" ADD COLUMN "boxStreaming" INTEGER;
