-- 7XEN Studio sends one kind of screenshot; the server detects lobby / in-game / results (services/liveCapture.ts)
ALTER TABLE "LiveCapture" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "LiveCapture" ADD COLUMN "hint" TEXT;
ALTER TABLE "LiveCapture" ADD COLUMN "detected" TEXT;
ALTER TABLE "LiveCapture" ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER TABLE "LiveCapture" ADD COLUMN "message" TEXT;
ALTER TABLE "LiveCapture" ADD COLUMN "screenshotId" TEXT;
