-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "matchId" TEXT,
ADD COLUMN     "outputDestIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "outputOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outputStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StreamLayout" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "sponsors" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StreamDestination" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StreamLayout_managerId_key" ON "StreamLayout"("managerId");

-- CreateIndex
CREATE INDEX "StreamDestination_managerId_idx" ON "StreamDestination"("managerId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamLayout" ADD CONSTRAINT "StreamLayout_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamDestination" ADD CONSTRAINT "StreamDestination_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
