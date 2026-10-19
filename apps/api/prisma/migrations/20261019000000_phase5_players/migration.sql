-- Phase 5: player accounts & teams (docs/phase5/PLAYERS.md). Hand-checked.
-- Owner approved deleting existing teams and TEAM logins (test data). Backup: backups/pre-phase5-*.dump
--
-- FKs pointing at "Team": Registration/TeamPlayer/TournamentEntry/GroupTeam CASCADE; MatchTeam.teamId,
-- Tournament.championTeamId, TeamRequest.teamId SET NULL — so deleting teams removes their registrations, tournament
-- entries, group slots and legacy rosters, and keeps match rows (teamId → null).
-- FKs pointing at a TEAM "User": Team.userId CASCADE, Registration.decidedById / TrainingSample.createdById SET NULL;
-- Screenshot.uploadedById / MatchRecording.managerId / Scrim.managerId / Tournament.managerId RESTRICT (TEAM users never own those).

DELETE FROM "TeamRequest";
DELETE FROM "Team";
DELETE FROM "User" WHERE "role" = 'TEAM';


-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SuggestionKind" AS ENUM ('SCRIM', 'TOURNAMENT');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- AlterEnum
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'MANAGER', 'PLAYER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "Role_old";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_userId_fkey";

-- DropForeignKey
ALTER TABLE "TeamRequest" DROP CONSTRAINT "TeamRequest_managerId_fkey";

-- DropForeignKey
ALTER TABLE "TeamRequest" DROP CONSTRAINT "TeamRequest_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "TeamRequest" DROP CONSTRAINT "TeamRequest_teamId_fkey";

-- DropIndex
DROP INDEX "Team_userId_key";

-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "registeredById" TEXT;

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "captainName",
DROP COLUMN "userId",
ADD COLUMN     "inviteCode" TEXT NOT NULL,
ADD COLUMN     "leaderId" TEXT NOT NULL,
ADD COLUMN     "logoKey" TEXT;

-- AlterTable
ALTER TABLE "TournamentEntry" ADD COLUMN     "registeredById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "bgmiId" TEXT,
ADD COLUMN     "googleSub" TEXT,
ADD COLUMN     "ign" TEXT,
ALTER COLUMN "username" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- DropTable
DROP TABLE "TeamRequest";

-- DropEnum
DROP TYPE "TeamRequestStatus";

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSuggestion" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "kind" "SuggestionKind" NOT NULL,
    "scrimId" TEXT,
    "date" TEXT,
    "tournamentId" TEXT,
    "note" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_teamId_status_idx" ON "TeamJoinRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_userId_status_idx" ON "TeamJoinRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "TeamSuggestion_teamId_status_idx" ON "TeamSuggestion"("teamId", "status");

-- CreateIndex
CREATE INDEX "MatchPlayer_userId_idx" ON "MatchPlayer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_leaderId_key" ON "Team"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_inviteCode_key" ON "Team"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE UNIQUE INDEX "User_bgmiId_key" ON "User"("bgmiId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSuggestion" ADD CONSTRAINT "TeamSuggestion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSuggestion" ADD CONSTRAINT "TeamSuggestion_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntry" ADD CONSTRAINT "TournamentEntry_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one PENDING join request per player
CREATE UNIQUE INDEX "TeamJoinRequest_one_pending" ON "TeamJoinRequest"("userId") WHERE "status" = 'PENDING';
