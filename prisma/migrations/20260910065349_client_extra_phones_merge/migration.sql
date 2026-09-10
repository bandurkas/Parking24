-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'MERGE';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "extraPhones" TEXT[] DEFAULT ARRAY[]::TEXT[];
