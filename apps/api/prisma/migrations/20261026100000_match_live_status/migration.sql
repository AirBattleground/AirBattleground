-- live team status for the 7XEN Studio Team Status board (GET /api/studio-link/matches/:id/live)
ALTER TABLE "Match" ADD COLUMN "liveTeams" JSONB;
ALTER TABLE "Match" ADD COLUMN "liveVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Match" ADD COLUMN "liveHash" TEXT;
ALTER TABLE "Match" ADD COLUMN "liveUpdatedAt" TIMESTAMP(3);
