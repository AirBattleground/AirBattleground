-- CreateTable
CREATE TABLE "StudioShow" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "matchId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "liveSince" TIMESTAMP(3),
    "destinationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioShow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioShow_managerId_idx" ON "StudioShow"("managerId");

-- CreateIndex
CREATE INDEX "StudioShow_state_idx" ON "StudioShow"("state");

-- AddForeignKey
ALTER TABLE "StudioShow" ADD CONSTRAINT "StudioShow_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

