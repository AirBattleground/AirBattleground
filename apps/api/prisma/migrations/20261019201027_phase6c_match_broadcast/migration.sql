-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "broadcastLive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "broadcastStartedAt" TIMESTAMP(3);
