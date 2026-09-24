-- Ф5: номер договора хранения (Booking.contractNumber), выдаётся при заезде; у старых броней NULL
ALTER TABLE "Booking" ADD COLUMN "contractNumber" INTEGER;

CREATE UNIQUE INDEX "Booking_contractNumber_key" ON "Booking"("contractNumber");
