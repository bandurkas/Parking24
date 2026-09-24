-- Ф14. Значения enum — отдельной миграцией, в ней же не используются.
-- MESSAGE_FAILED добавляет и Ф4ш0. IF NOT EXISTS спасает, только если эта папка идёт ПОСЛЕ миграции Ф4ш0
-- (или Ф4ш0 тоже пишет IF NOT EXISTS): иначе на чистой базе упадёт её ADD VALUE — порядок папок ставит оркестратор
ALTER TYPE "NoticeKind" ADD VALUE IF NOT EXISTS 'CLIENT_MESSAGE';
ALTER TYPE "NoticeKind" ADD VALUE IF NOT EXISTS 'MESSAGE_FAILED';
