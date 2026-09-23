-- AlterEnum: роли водителя и парковщика (МФ-UI). Только объявление значений — использование в seed идёт отдельным процессом после коммита миграции
ALTER TYPE "Role" ADD VALUE 'DRIVER';
ALTER TYPE "Role" ADD VALUE 'PARKER';
