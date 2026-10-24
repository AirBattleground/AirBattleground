-- AlterTable
ALTER TABLE "Scrim" ADD COLUMN     "regOpenTime" TEXT,
ADD COLUMN     "regOpenDaysBefore" INTEGER NOT NULL DEFAULT 0;
