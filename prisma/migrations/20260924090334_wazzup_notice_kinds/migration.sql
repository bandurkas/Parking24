-- Ф14. Значения enum — отдельной миграцией, в ней же не используются.
-- MESSAGE_FAILED добавляет и Ф4ш0: IF NOT EXISTS делает вторую миграцию пустой при любом порядке слияния
ALTER TYPE "NoticeKind" ADD VALUE IF NOT EXISTS 'CLIENT_MESSAGE';
ALTER TYPE "NoticeKind" ADD VALUE IF NOT EXISTS 'MESSAGE_FAILED';
