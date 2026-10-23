-- when the match went live (lineup confirmed / 7XEN Studio Start): drives the studio's on-screen elapsed timer
ALTER TABLE "Match" ADD COLUMN "liveAt" TIMESTAMP(3);
