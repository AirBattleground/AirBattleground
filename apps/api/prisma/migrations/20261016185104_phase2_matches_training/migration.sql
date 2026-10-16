-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LINEUP_REVIEW', 'LIVE', 'RESULTS_REVIEW', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ScreenshotKind" AS ENUM ('SLOT_LIST', 'RESULTS');

-- CreateEnum
CREATE TYPE "ScreenshotStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "SampleSplit" AS ENUM ('TRAIN', 'TEST');

-- CreateEnum
CREATE TYPE "SampleSource" AS ENUM ('ADMIN_UPLOAD', 'MANAGER_CORRECTION', 'SEED');

-- AlterTable
ALTER TABLE "Scrim" ADD COLUMN     "pointsSystem" JSONB;

-- CreateTable
CREATE TABLE "TeamPlayer" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "ign" TEXT NOT NULL,
    "bgmiId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "map" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "kind" "ScreenshotKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "ScreenshotStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "extraction" JSONB,
    "error" TEXT,
    "modelVersion" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTeam" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "teamId" TEXT,
    "placement" INTEGER,
    "kills" INTEGER,
    "placementPoints" INTEGER,
    "killPoints" INTEGER,
    "totalPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" TEXT NOT NULL,
    "matchTeamId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "ocrName" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "kills" INTEGER,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSample" (
    "id" TEXT NOT NULL,
    "kind" "ScreenshotKind" NOT NULL,
    "source" "SampleSource" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "labels" JSONB NOT NULL,
    "split" "SampleSplit" NOT NULL DEFAULT 'TRAIN',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "screenshotId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamPlayer_teamId_idx" ON "TeamPlayer"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_sessionId_number_key" ON "Match"("sessionId", "number");

-- CreateIndex
CREATE INDEX "Screenshot_status_createdAt_idx" ON "Screenshot"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Screenshot_matchId_sha256_key" ON "Screenshot"("matchId", "sha256");

-- CreateIndex
CREATE INDEX "MatchTeam_teamId_idx" ON "MatchTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchTeam_matchId_slotNumber_key" ON "MatchTeam"("matchId", "slotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchTeamId_position_key" ON "MatchPlayer"("matchTeamId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSample_sha256_key" ON "TrainingSample"("sha256");

-- CreateIndex
CREATE INDEX "TrainingSample_kind_split_idx" ON "TrainingSample"("kind", "split");

-- AddForeignKey
ALTER TABLE "TeamPlayer" ADD CONSTRAINT "TeamPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ScrimSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTeam" ADD CONSTRAINT "MatchTeam_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTeam" ADD CONSTRAINT "MatchTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchTeamId_fkey" FOREIGN KEY ("matchTeamId") REFERENCES "MatchTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSample" ADD CONSTRAINT "TrainingSample_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
