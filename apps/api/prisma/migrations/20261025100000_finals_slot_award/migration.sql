-- Weekly Board finals slot: what an invite was won for + the text on the team's Finals Slot card
ALTER TABLE "TournamentEntry" ADD COLUMN "awardKey" TEXT;
ALTER TABLE "TournamentEntry" ADD COLUMN "awardNote" TEXT;
CREATE INDEX "TournamentEntry_awardKey_idx" ON "TournamentEntry"("awardKey");
