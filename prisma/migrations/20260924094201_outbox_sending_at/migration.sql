-- Момент передачи записи адаптеру: при истёкшей аренде отличает «статус неизвестен» от «не дошло до отправки»
-- AlterTable
ALTER TABLE "Outbox" ADD COLUMN     "sendingAt" TIMESTAMP(3);
