import "server-only";

// Точка входа сервиса броней. Файл был разрезан 23.09 перед параллельной работой по дорожкам:
// один `bookings.ts` на 524 строки трогали девять фаз сразу. Поведение при разрезе не менялось.
// Где что искать:
//   create.ts     — создание брони и решение о стартовом статусе (автоподтверждение)
//   transition.ts — переходы по статусам, перестой и начисление при выезде
//   correct.ts    — «Исправить статус»: правка ошибки без автоматизаций
//   payments.ts   — платежи, возвраты, цена, пересчёт по факту, снятие начисления
//   edit.ts       — правка брони, продление, комментарии
//   queries.ts    — выборки и общий include
//   shared.ts     — блокировка строки, общие проверки и формулировки
export { BookingError } from "./shared";
export { createBooking, type AfterCreate, type CreateBookingData, type CreateHooks, type StatusDecider, type StatusDecision } from "./create";
export { canTransition, transition } from "./transition";
export { correctStatus } from "./correct";
export { addPayment, changePrice, decideRecalc, waiveOverstay } from "./payments";
export { addComment, extendStay, updateBooking } from "./edit";
export { bookingInclude, findByPhoneOrPlate, normalizeContact, type BookingFull } from "./queries";
