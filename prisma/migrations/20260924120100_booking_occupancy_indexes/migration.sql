-- Ф3: выборка занятости «парковка + статусы + диапазон дат»
CREATE INDEX "Booking_kind_status_dateFrom_idx" ON "Booking"("kind", "status", "dateFrom");

CREATE INDEX "Booking_kind_status_dateTo_idx" ON "Booking"("kind", "status", "dateTo");
