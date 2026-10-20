-- AlterTable
ALTER TABLE "Scrim" ADD COLUMN     "winCoins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "winCoins" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CoinAward" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoinAward_matchId_key" ON "CoinAward"("matchId");

-- CreateIndex
CREATE INDEX "CoinAward_teamId_idx" ON "CoinAward"("teamId");

-- CreateIndex
CREATE INDEX "CoinAward_userId_idx" ON "CoinAward"("userId");

-- AddForeignKey
ALTER TABLE "CoinAward" ADD CONSTRAINT "CoinAward_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAward" ADD CONSTRAINT "CoinAward_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoinAward" ADD CONSTRAINT "CoinAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
