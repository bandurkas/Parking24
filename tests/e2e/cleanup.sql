-- Очистка тестовых данных e2e на stage:
--   docker exec -i parking24-db psql -U parking24 -d parking24 < tests/e2e/cleanup.sql
-- Тестовые признаки: госномер начинается на Т000, телефон — на +7999.
BEGIN;

CREATE TEMP TABLE _tb AS
  SELECT id FROM "Booking" WHERE plate LIKE 'Т000%' OR "contactPhone" LIKE '+7999%';
CREATE TEMP TABLE _tc AS
  SELECT id FROM "Client" WHERE phone LIKE '+7999%';

DELETE FROM "Outbox"      WHERE "bookingId" IN (SELECT id FROM _tb) OR "clientId" IN (SELECT id FROM _tc);
DELETE FROM "Interaction" WHERE "bookingId" IN (SELECT id FROM _tb) OR "clientId" IN (SELECT id FROM _tc);
DELETE FROM "Payment"     WHERE "bookingId" IN (SELECT id FROM _tb);
DELETE FROM "Booking"     WHERE id IN (SELECT id FROM _tb);
DELETE FROM "Vehicle"     WHERE "clientId" IN (SELECT id FROM _tc);
DELETE FROM "Client"      WHERE id IN (SELECT id FROM _tc);
-- Ф14: входящие вебхука с незнакомых номеров и их уведомления
DELETE FROM "Interaction" WHERE "externalId" LIKE 'wz:e2e-%';
DELETE FROM "AdminNotice" WHERE "bookingId" IS NULL AND (text LIKE '%«E2E:%' OR text LIKE '%E2E_NEW_CODE%');

SELECT (SELECT count(*) FROM _tb) AS "броней удалено", (SELECT count(*) FROM _tc) AS "клиентов удалено";

COMMIT;
