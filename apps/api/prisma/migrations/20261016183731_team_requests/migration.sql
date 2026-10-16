-- CreateEnum
CREATE TYPE "TeamRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TeamRequest" (
    "id" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "captainName" TEXT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "TeamRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamRequest_teamId_key" ON "TeamRequest"("teamId");

-- CreateIndex
CREATE INDEX "TeamRequest_status_createdAt_idx" ON "TeamRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TeamRequest_managerId_status_idx" ON "TeamRequest"("managerId", "status");

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRequest" ADD CONSTRAINT "TeamRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A team name / username can only be held by one PENDING request at a time.
CREATE UNIQUE INDEX "TeamRequest_pending_nameKey_key" ON "TeamRequest"("nameKey") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "TeamRequest_pending_username_key" ON "TeamRequest"("username") WHERE "status" = 'PENDING';
