-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "channels" "Channel"[] DEFAULT ARRAY[]::"Channel"[];
