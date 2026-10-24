-- preset artwork drawn for scrims without an uploaded poster
ALTER TABLE "Scrim" ADD COLUMN "posterTemplate" TEXT NOT NULL DEFAULT 'TOPO';
