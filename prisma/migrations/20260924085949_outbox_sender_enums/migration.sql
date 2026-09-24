-- Новые значения enum отдельной миграцией и без использования в ней же (PLAN §3)
-- AlterEnum
ALTER TYPE "OutboxStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "OutboxStatus" ADD VALUE 'SKIPPED';

-- AlterEnum
ALTER TYPE "NoticeKind" ADD VALUE 'MESSAGE_FAILED';
