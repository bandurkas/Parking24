-- Очистка тестовых данных e2e на stage:
--   docker exec -i parking24-db psql -U parking24 -d parking24 < tests/e2e/cleanup.sql
-- Тестовые признаки: госномер начинается на Т000, телефон — на +7999, логин пользователя — на e2e_.
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

-- Кассовые смены e2e (Ф11): метка — инкассация «E2E-инкассатор»; чужие платежи в них только отвязываются
CREATE TEMP TABLE _ts AS
  SELECT DISTINCT "shiftId" AS id FROM "CashCollection" WHERE "takenBy" LIKE 'E2E%';
UPDATE "Payment"        SET "cashShiftId" = NULL WHERE "cashShiftId" IN (SELECT id FROM _ts);
DELETE FROM "CashCollection" WHERE "shiftId" IN (SELECT id FROM _ts);
DELETE FROM "CashShift"      WHERE id IN (SELECT id FROM _ts);

SELECT (SELECT count(*) FROM _tb) AS "броней удалено", (SELECT count(*) FROM _tc) AS "клиентов удалено", (SELECT count(*) FROM _ts) AS "смен удалено";

-- МФ-2: тестовые пользователи e2e_* и их записи в журнале (иначе вход и выход стали бы «автоматическими»); сессии — каскадом
DELETE FROM "AuditLog" WHERE "userId" IN (SELECT id FROM "User" WHERE login LIKE 'e2e\_%');
WITH d AS (DELETE FROM "User" WHERE login LIKE 'e2e\_%' RETURNING id) SELECT count(*) AS "тестовых пользователей удалено" FROM d;

COMMIT;
