-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('LIVE', 'STOPPED', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "roomId" TEXT,
ADD COLUMN     "roomPassword" TEXT,
ADD COLUMN     "roomRevealAt" TIMESTAMP(3),
ADD COLUMN     "roomUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Screenshot" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'WEB';

-- CreateTable
CREATE TABLE "MatchRecording" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'LIVE',
    "deviceName" TEXT,
    "appVersion" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "videoKey" TEXT,
    "posterKey" TEXT,
    "sizeBytes" BIGINT,
    "uploadedBytes" BIGINT NOT NULL DEFAULT 0,
    "width" INTEGER,
    "height" INTEGER,
    "events" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "managerId" TEXT,
    "deviceProfile" TEXT,
    "steps" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "MatchRecording_matchId_idx" ON "MatchRecording"("matchId");

-- CreateIndex
CREATE INDEX "MatchRecording_status_createdAt_idx" ON "MatchRecording"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_key_managerId_key" ON "Recipe"("key", "managerId");

-- AddForeignKey
ALTER TABLE "MatchRecording" ADD CONSTRAINT "MatchRecording_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRecording" ADD CONSTRAINT "MatchRecording_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- one admin default per recipe key (NULL managerId is not covered by the composite unique)
CREATE UNIQUE INDEX "Recipe_default_key" ON "Recipe"("key") WHERE "managerId" IS NULL;
