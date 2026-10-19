-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS');

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'IOS',
    "keyHash" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "model" TEXT,
    "osVersion" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "streamingSince" TIMESTAMP(3),
    "health" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_keyHash_key" ON "Device"("keyHash");

-- CreateIndex
CREATE INDEX "Device_managerId_idx" ON "Device"("managerId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
