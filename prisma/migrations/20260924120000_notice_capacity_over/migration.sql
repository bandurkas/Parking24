-- Ф3: уведомление «сверх вместимости». Новое значение enum — отдельной миграцией, в ней не используется
ALTER TYPE "NoticeKind" ADD VALUE 'CAPACITY_OVER';
