-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'DRAWN', 'LIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('REGISTERED', 'INVITED');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'REMOVED');

-- CreateEnum
CREATE TYPE "GroupTeamStatus" AS ENUM ('ACTIVE', 'ADVANCED', 'ELIMINATED', 'DISQUALIFIED');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "lobbyIndex" INTEGER,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ALTER COLUMN "sessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "rules" TEXT,
    "prize" TEXT,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "pointsSystem" JSONB,
    "teamSize" INTEGER NOT NULL DEFAULT 4,
    "firstSlot" INTEGER NOT NULL DEFAULT 1,
    "maxTeams" INTEGER NOT NULL,
    "registrationOpensAt" TIMESTAMP(3),
    "registrationClosesAt" TIMESTAMP(3),
    "championTeamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentStage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "teamsIn" INTEGER NOT NULL,
    "lobbySize" INTEGER NOT NULL DEFAULT 16,
    "groupCount" INTEGER NOT NULL,
    "matchesPerGroup" INTEGER NOT NULL,
    "maps" TEXT[],
    "advancePerGroup" INTEGER NOT NULL,
    "wildcardCount" INTEGER NOT NULL DEFAULT 0,
    "invitedSlots" INTEGER NOT NULL DEFAULT 0,
    "schedule" JSONB,
    "drawSeed" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntry" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "EntryType" NOT NULL DEFAULT 'REGISTERED',
    "status" "EntryStatus" NOT NULL,
    "entryStage" INTEGER NOT NULL DEFAULT 1,
    "timePreferences" TEXT[],
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentGroup" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lobbyIndex" INTEGER,
    "slotId" TEXT,
    "startsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupTeam" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "seed" INTEGER,
    "status" "GroupTeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "advancedVia" TEXT,
    "finalRank" INTEGER,
    "dqReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");

-- CreateIndex
CREATE INDEX "Tournament_managerId_idx" ON "Tournament"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_order_key" ON "TournamentStage"("tournamentId", "order");

-- CreateIndex
CREATE INDEX "TournamentEntry_tournamentId_status_registeredAt_idx" ON "TournamentEntry"("tournamentId", "status", "registeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentEntry_tournamentId_teamId_key" ON "TournamentEntry"("tournamentId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentGroup_stageId_index_key" ON "TournamentGroup"("stageId", "index");

-- CreateIndex
CREATE INDEX "GroupTeam_teamId_idx" ON "GroupTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTeam_groupId_teamId_key" ON "GroupTeam"("groupId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupTeam_groupId_slotNumber_key" ON "GroupTeam"("groupId", "slotNumber");

-- CreateIndex
CREATE INDEX "Match_scheduledAt_idx" ON "Match"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_groupId_number_key" ON "Match"("groupId", "number");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_championTeamId_fkey" FOREIGN KEY ("championTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentGroup" ADD CONSTRAINT "TournamentGroup_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTeam" ADD CONSTRAINT "GroupTeam_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TournamentGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupTeam" ADD CONSTRAINT "GroupTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A match belongs to exactly one of: a scrim session, a tournament group.
ALTER TABLE "Match" ADD CONSTRAINT "Match_owner_check" CHECK (("sessionId" IS NULL) <> ("groupId" IS NULL));
