-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('LEAD', 'ACTIVE', 'VIP', 'LOST', 'BLOCKED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "birthday" DATE,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "consentMarketingAt" TIMESTAMP(3),
ADD COLUMN     "consentPersonalAt" TIMESTAMP(3),
ADD COLUMN     "consentSource" TEXT,
ADD COLUMN     "doNotDisturb" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inn" TEXT,
ADD COLUMN     "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "telegram" TEXT;

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");
