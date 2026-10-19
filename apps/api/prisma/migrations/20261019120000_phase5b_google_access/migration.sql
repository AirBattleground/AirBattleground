-- CreateEnum
CREATE TYPE "ManagerInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "orgName" TEXT;

-- CreateTable
CREATE TABLE "ManagerInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "status" "ManagerInviteStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT,
    "acceptedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "ManagerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManagerInvite_email_idx" ON "ManagerInvite"("email");

-- CreateIndex
CREATE INDEX "ManagerInvite_status_createdAt_idx" ON "ManagerInvite"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ManagerInvite" ADD CONSTRAINT "ManagerInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerInvite" ADD CONSTRAINT "ManagerInvite_acceptedUserId_fkey" FOREIGN KEY ("acceptedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one PENDING invitation per email
CREATE UNIQUE INDEX "ManagerInvite_one_pending" ON "ManagerInvite"("email") WHERE "status" = 'PENDING';
