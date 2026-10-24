-- per-match start + IDP times, registration close offset and draft/published for scrims
ALTER TABLE "Scrim" ADD COLUMN "matchTimes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Scrim" ADD COLUMN "idpMinutes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Scrim" ADD COLUMN "registrationCloseMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Scrim" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true;
