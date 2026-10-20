-- phase 8b: Studio workers (a manager's own PC renders + encodes Studio shows)

-- AlterTable
ALTER TABLE "StudioShow" ADD COLUMN "runOn" TEXT NOT NULL DEFAULT 'browser',
ADD COLUMN "workerId" TEXT,
ADD COLUMN "control" JSONB,
ADD COLUMN "controlVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StudioWorker" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'idle',
    "encoder" TEXT,
    "version" TEXT,
    "showId" TEXT,
    "fps" DOUBLE PRECISION,
    "bitrateKbps" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioWorker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioWorker_keyHash_key" ON "StudioWorker"("keyHash");

-- CreateIndex
CREATE INDEX "StudioWorker_managerId_idx" ON "StudioWorker"("managerId");

-- AddForeignKey
ALTER TABLE "StudioWorker" ADD CONSTRAINT "StudioWorker_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
