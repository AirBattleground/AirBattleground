-- CreateEnum
CREATE TYPE "TournamentMode" AS ENUM ('BR', 'TDM');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "mode" "TournamentMode" NOT NULL DEFAULT 'BR';

-- AlterTable
ALTER TABLE "CoinAward" ADD COLUMN     "tournamentId" TEXT,
ALTER COLUMN "matchId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CoinAward_tournamentId_key" ON "CoinAward"("tournamentId");

-- AddForeignKey
ALTER TABLE "CoinAward" ADD CONSTRAINT "CoinAward_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
