# Карта взаимосвязей фаз Parkovka24 (24.09.2026)

Собрана не вручную: каждая из семнадцати архитектур вернула список файлов, которые она меняет, и список того, чего ждёт от соседних фаз. Здесь это сведено в одну таблицу.

**Как этим пользоваться.** Берёшь свою фазу в §2 — видишь, от чего она зависит и чего ждёт. Перед правкой файла смотришь §3 — кто ещё его трогает и кто идёт первым. Если ты первый, пишешь как удобно; если не первый — дожидаешься предшественника и правишь поверх, а не вместо.

## 1. Дорожки и порядок работ

Семь дорожек идут параллельно. Внутри дорожки фазы строго по очереди — они делят одни и те же файлы. Номер — глобальный порядок с учётом межфазных зависимостей: фаза с меньшим номером трогает общий файл первой.

| Дорожка | Фазы по порядку |
|---|---|
| **Д1** Уведомления и заявки | **МФ-1** (5) → **Ф8** (11) |
| **Д2** Занятость и экраны | **Ф9а** (1) → **Ф3** (7) → **Ф9б** (12) |
| **Д3** Транспорт сообщений | **Ф4ш0** (3) → **Ф14** (14) |
| **Д4** Тексты и события | **МФ-2** (4) → **Ф5** (10) → **Ф6** (13) → **Ф7** (15) |
| **Д5** Деньги | **Ф10** (9) → **Ф11** (16) → **Ф12** (17) |
| **Д6** Табель | **Ф13** (8) |
| **Д7** Инфраструктура | **МФ-3а** (6) → **МФ-3б** (18) |

Ф2б (перестой: уведомления и режимы сканов) в таблице нет: её архитектура написана раньше и лежит в `PHASE_02_OVERSTAY.md` §4.6–4.8. По порядку она идёт первой в Д1, до МФ-1.

**Обновление 24.09 вечер: перед всеми дорожками встаёт МФ-UI (0)** — решение пользователя «сначала интерфейс, потом код Ф9а», документ `PHASE_MFUI_MENU_ROLES.md`. Она не входит ни в одну из семи дорожек и не в списке фаз 1–18 выше — глобальный шаг 0, до которого код не начинает никто, включая Ф9а. После слияния МФ-UI: сначала код Ф9а (1), затем все семь дорожек параллельно, как решено 22–23.09. Она переставляет «первого владельца» шести файлов из §3 (были за Ф9а/Ф4ш0/МФ-2/Ф9б) и добавляет ещё четыре файла, которых в карте не было вовсе — подробно в §3.

## 2. Фазы: что делает, чего ждёт от соседей

### 0. МФ-UI — Меню, роли и доступы, сверка интерфейса с ТЗ

Вне дорожек, идёт первой глобально · документ `PHASE_MFUI_MENU_ROLES.md` · файлов меняет: 21 (+ тесты и `package.json`): десять перехватывает у других фаз первой, три существующих регистрирует в карте впервые (`guard.ts`, `login/page.tsx`, `GlobalSearch.tsx`), восемь создаёт; `(app)/layout.tsx` внесён в карту для сведения — его МФ-UI не меняет.

Ни от кого ничего не ждёт. **Все остальные фазы, включая Ф9а, ждут её слияния в `main`** — см. §1.

### 1. Ф9а — Убрать ручное время; забытая отметка — датой

Дорожка Д2 · документ `PHASE_09A_MANUAL_TIME.md` · файлов меняет: 24

Ни от кого ничего не ждёт — можно начинать сразу.

### 3. Ф4ш0 — Отправщик Outbox и предохранители

Дорожка Д3 · документ `PHASE_04_SENDER.md` · файлов меняет: 29

Ни от кого ничего не ждёт — можно начинать сразу.

### 4. МФ-2 — Настройки CRM: шаблоны, правила, пользователи, тарифы

Дорожка Д4 · документ `PHASE_MF2_CRM_SETTINGS.md` · файлов меняет: 43

Ни от кого ничего не ждёт — можно начинать сразу.

### 5. МФ-1 — Автоподтверждение: надёжность и предохранитель

Дорожка Д1 · документ `PHASE_MF1_AUTOCONFIRM.md` · файлов меняет: 16

**Ждёт от соседних фаз:**

- Ф2б: notify(kind, text, bookingId, { tx, key }) — МФ-1 передаёт транзакцию и ключ `reject-no-space:<id брони>`. До слияния Ф2б работает текущая сигнатура notify(kind, text, bookingId, tx) (notices.ts:6), ключ дописывается одной строкой.
- Ф2б: markNoticesReadAction(ids) с обязательными ids, без ветки «погасить все» (PHASE_02_OVERSTAY §4.7 п.27). Это условие сдачи МФ-1: иначе автоотказ, пришедший после отрисовки панели, гаснет непрочитанным. notices.ts и NoticeBell.tsx МФ-1 не трогает.
- Ф4 шаг 0: Setting `messaging.senderEnabled` (boolean, по умолчанию false) = true, когда отправщик включён и у него есть рабочий канал. Предохранитель читает именно этот ключ; если Ф4 назовёт ключ иначе — сообщить, правка в одну строку в autoConfirmGate.
- Ф5: активное правило AutomationRule с trigger = STATUS_CHANGED, triggerParams.status = "REJECTED" и активным шаблоном (в seed — активным). Предохранитель проверяет только наличие активного правила с активным шаблоном, различение текстов «нет мест» / «отклонено» по rejectKind — полностью в Ф5.
- Ф3: проверку потолка 405 при создании брони в CRM делать внутри того же хука decide у createBooking и тем же lockOccupancy(tx); второй замок не заводить. Сигнатура: decide(tx, { amount, days }), хуки передаются объектом createBooking(input, actor, { decide, afterCreate }).
- Ф3: ключ parking.newLeadHoldHours и решение «держит ли место Новая заявка» — целиком Ф3, МФ-1 в settings.ts добавляет только необязательный аргумент db у parkingSettings.
- Ф6: уведомление «у клиента уже есть бронь на другие даты» строить поверх вынесенных МФ-1 функций duplicateLeadWhere / findDuplicateLead в leads.ts, не заводя второе правило поиска повтора.
- МФ-2: на странице «Сообщения» правило отказа на «Отклонена» нельзя выключать молча, пока автоподтверждение включено — как минимум предупреждение. Иначе включённое АП уходит в деградацию «мест нет, а отказать нечем».
- Оркестратор: порядок слияния Д1 × Д2 — МФ-1 раньше Ф3 (общие createBooking, actions/settings.ts, CapacityForm). МФ-1 забирает из saveCapacityAction поле autoConfirm; Ф3 доделывает форму ёмкости поверх.

### 6. МФ-3а — Бэкапы: скрипт, проверка восстановления, runbook

Дорожка Д7 · документ `PHASE_MF3A_BACKUPS.md` · файлов меняет: 17

Ни от кого ничего не ждёт — можно начинать сразу.

### 7. Ф3 — Занятость по ТЗ и потолок 405 в CRM

Дорожка Д2 · документ `PHASE_03_OCCUPANCY.md` · файлов меняет: 33

**Ждёт от соседних фаз:**

- Ф9а: transition(bookingId, to, actor, { reason }) БЕЗ параметра `at`, transitionAction без `at`, и уже поправленные tests/e2e/crm-pipeline.mjs:73 и overstay.mjs:54,128,187. Потолок я пишу поверх этой сигнатуры; если `at` останется, мой код всё равно соберётся, но Ф9а придётся править transition.ts вторым заходом.
- МФ-1: предохранитель включения автоподтверждения в saveCapacityAction остаётся на месте — я дописываю сверку вместимости с занятостью ПОВЕРХ него, в той же функции, ниже по коду. МФ-1 мержится раньше.
- МФ-1: parkingSettings, принимающая транзакцию (parkingSettings(tx)), чтобы чтение настроек внутри транзакции автоподтверждения не брало второе соединение. Мне нужно то же самое для parking.newLeadHoldHours внутри checkFit. Если МФ-1 этого не сделает, я читаю настройки ДО открытия транзакции и передаю holdSince параметром.
- Ф4 шаг 0: один помощник строгой проверки ЧЧ:ММ (например isHHMM в src/lib или src/server/lib/dates.ts) вместо /^\d{2}:\d{2}$/. Он нужен мне в plannedMoment: сейчас «25:00» проходит регулярку и даёт Invalid Date, из-за чего бронь молча выпадает из окна 24 ч. Ф4 шаг 0 идёт раньше; если помощника не будет, я заведу его сам в dates.ts, и Ф4 возьмёт мой.
- Ф2б: уведомления. Я пишу notify("CAPACITY_OVER", ...) существующей сигнатурой notify(kind, text, bookingId, tx). Если Ф2б введёт notify(..., { tx, key }) с ключом дедупликации, перевести мои два вызова на неё — правка в одном файле (guardCapacity в bookings/shared.ts).
- Ф2б: значение CAPACITY_OVER в enum NoticeKind добавляю я отдельной миграцией. Если Ф2б в той же волне добавляет OVERSTAY, оркестратор 1 сводит две миграции enum в правильном порядке — обе только добавляют значения и ни одна не использует своё значение в себе.
- Ф9б: берёт из src/server/lib/dates.ts помощники plannedCheckIn, plannedCheckOut, within24h, before24h и из src/server/services/occupancy.ts функции arrivalsIn24h(now) и departuresIn24h(now) → { total, overdue }. Табло «Планируют выезд · 24 ч», фильтр в таблице и списки «Прибытие»/«Отправление» на экране «Сегодня» делает Ф9б, я их не трогаю — только шапку с полосой занятости (форма данных занятости меняется).
- Ф9б: предупреждение о раннем заезде. Я в transition ставлю мягкую проверку мест на отрезке [сегодня, dateTo] и пишу строку в ленту; текст предупреждения администратору на экране — за Ф9б.
- Ф10: correct.ts правим оба, Ф3 раньше. Я добавляю в correctStatus ТОЛЬКО проверку мест (lockOccupancy первым + guardCapacity), деньги, время забытого заезда и запрет открывать закрытую бронь — за Ф10. Порядок блокировок lockOccupancy → lockBooking нарушать нельзя: Ф10 добавляет свои проверки ПОСЛЕ lockBooking.
- Ф10: в payments.ts я трогаю одну ветку — авто-подъём NEW/AWAITING_PAYMENT → CONFIRMED при полной оплате, куда добавляется мягкая проверка мест и запись в ленту. Возвраты, сторно, Payment.reason — Ф10.
- Ф6: сообщение «бронь изменена» при смене дат в updateBooking. Я в updateBooking добавляю только потолок перед записью; вызов автоматизаций и AutomationTrigger.BOOKING_CHANGED — за Ф6, Ф3 мержится раньше.
- Ф12: месяц по Москве на дашборде и в отчёте. Я в dashboard/page.tsx меняю только плитку «Сейчас на стоянке» (перевод на parkingToday, чтобы в неё не попадали комнаты); границы периода по Москве — Ф12.
- МФ-2 «Настройки CRM»: поле parking.newLeadHoldHours живёт на странице /admin/settings/capacity (моей), дублировать его на новых страницах настроек не нужно.
- Оркестратор: e2e-файлы overstay.mjs и autoconfirm.mjs я НЕ правлю — формулировки «занято бронями N» и «Занято N из M» сохраняются намеренно. Если другая фаза меняет эти подписи, сломаются оба теста.

### 8. Ф13 — Табель рабочих смен

Дорожка Д6 · документ `PHASE_13_TIMESHEET.md` · файлов меняет: 22

Ни от кого ничего не ждёт — можно начинать сразу.

### 9. Ф10 — Возвраты, пересчёт, «Исправить статус»

Дорожка Д5 · документ `PHASE_10_REFUNDS.md` · файлов меняет: 32

Ни от кого ничего не ждёт — можно начинать сразу.

### 10. Ф5 — Сообщения по статусам, номер договора

Дорожка Д4 · документ `PHASE_05_STATUS_MESSAGES.md` · файлов меняет: 20

**Ждёт от соседних фаз:**

- Ф4 шаг 0: отправщик берёт только записи с scheduledAt <= now, и возраст сообщения для порога «не слать старше N часов» считает ОТ scheduledAt, а не от createdAt — иначе «спасибо и отзыв» с задержкой 120 минут срежется предохранителем
- Ф4 шаг 0: список OFF_BY_DECISION в prisma/seed.ts (before_checkout_2d, after_checkout_7d выключены и при создании, и при обновлении). Кто сливается первым — тот и заводит; Ф5 второй механизм не создаёт
- Ф4 шаг 0: запись Outbox без получателя или без канала получает терминальный статус (SKIPPED), а не висит PENDING вечно
- Ф4 шаг 0: функция channelForClient(client) — выбор канала; Ф5 выбор канала не трогает
- Ф4 шаг 0: компонент OutboxList в карточке брони показывает код правила, статус и время по Москве — на эти подписи опираются e2e Ф5
- МФ-2: поля AutomationRule.editedAt/editedById и цикл сида, который не включает обратно правило, выключенное человеком в CRM
- МФ-2: страница /admin/settings/automations с выключателем у каждого правила — четыре правила Ф5 приезжают выключенными и включаются там
- МФ-2: страница /admin/settings/templates и поля MessageTemplate.defaultBody/editedAt — заказчик вставит текст Влада без выкатки
- МФ-2: поле links.review на странице «Ссылки и политика» (ключ Setting уже есть, siteLinks его читает)
- МФ-2: функция ruleWhen(trigger, params) в src/lib/crm/automation-labels.ts — Ф5 дописывает в неё ветки rejectKind и delayMinutes
- МФ-2: страница /admin/settings/policy — в неё Ф5 вставляет карточку «Номер договора» (один блок)
- МФ-2: окончательная форма записи SeedTemplate в prisma/templates.ts (признак ручной правки вместо sync) — Ф5 добавляет 4 записи в этой форме
- Ф3: проверка мест при переходе «Отклонена» → «Ожидает оплаты» (Ф5 в этом переходе только отменяет неотправленный отказ)
- Ф9а: удаление ручного времени в transition() — Ф5 вставляет свой блок в ту же функцию, сливаться после Ф9а
- Ф10: всё остальное в correct.ts (забытый заезд, сторно, открытие закрытой брони); Ф5 добавляет туда один if про номер договора
- Ф6 и Ф7: ключ дедупликации с датой и новые значения AutomationTrigger — Ф5 их не заводит и на них не опирается
- Ф8: rejectKind = NO_SPACE остаётся признаком сегмента «не смогли к нам попасть» — смысл поля Ф5 не меняет
- Заказчик: текст сообщения при заезде (Влад) и ссылка на отзывы (Яша) — фазу не блокируют, правила выкатываются выключенными

### 11. Ф8 — Сегмент «не смогли попасть»

Дорожка Д1 · документ `PHASE_08_MISSED_SEGMENT.md` · файлов меняет: 26

**Ждёт от соседних фаз:**

- МФ-1: StatusDecider возвращает причину отклонения явно — { status, note, rejectKind } — вместо жёсткого rejectKind: "NO_SPACE" в src/server/services/bookings/create.ts:61; иначе любая бронь, созданная сразу в REJECTED по другой причине, попадёт в сегмент «не смогли попасть»
- МФ-1: в createSiteLead сохранить точку после создания брони, где доступны booking.clientId и booking.id (сейчас leads.ts:103-106) — туда встаёт запись согласия на рассылки; если блок переносится внутрь транзакции, setMarketingConsent(..., tx) принимает tx
- МФ-1: ветка дубля заявки (leads.ts:56-64) должна остаться отдельной — Ф8 дописывает в неё запись согласия, чтобы повторная отправка формы с галочкой не теряла его
- Ф10: отметка отклонения не стирается при возврате брони из «Отклонена» — нужен один индексируемый способ спросить «была ли у брони отметка NO_SPACE когда-либо». Рекомендация: не обнулять rejectedAt/rejectKind/rejectReason в bookings/transition.ts:72-76 и bookings/correct.ts:28, а добавить поле rejectClearedAt DateTime?
- Ф5: при ручном отклонении администратор выбирает причину, rejectKind ставится NO_SPACE или OTHER (сейчас transition.ts:68 всегда пишет OTHER). Ф5 это нужно самой для выбора между двумя текстами отказа; Ф8 только читает результат
- Ф4 (шаг 0 отправщика): служебные сообщения (подтверждение, напоминание, «не приехали», отзыв) НЕ проверяют consentMarketingAt — это исполнение договора, а не реклама. Для будущих рекламных сообщений единственная проверка — canMarket() из src/lib/consent.ts, свою не писать
- МФ-2: если текст согласия переезжает в настройки CRM, редакции обязаны храниться отдельными записями с кодом (textCode), а не перезаписывать одну строку — иначе журнал ConsentEvent перестаёт быть доказательством согласия
- МФ-2: пункт «Рассылки и согласия» Ф8 дописывает в конец массива ITEMS в settings/page.tsx; МФ-2 вольна его переставить при сборке своей структуры настроек
- МФ-3б: заголовки безопасности должны накрыть новый публичный маршрут /api/public/flags; правило «CSV только владельцу с записью EXPORT в журнал» Ф8 для своей выгрузки уже выполняет — переделывать не нужно
- Ф12: число отклонённых заявок берётся из броней, а не из сегмента Ф8 — сегмент считает людей, отчёт считает заявки

### 12. Ф9б — Табло «Планируют выезд», фильтры, МСК

Дорожка Д2 · документ `PHASE_09B_BOARDS.md` · файлов меняет: 23

**Ждёт от соседних фаз:**

- Ф3: `plannedMoment(date, time, tz?)` в `src/server/lib/dates.ts` — починенный, не зависящий от часового пояса процесса, сигнатура прежняя, с юнит-тестом
- Ф3: в `src/lib/occupancy-math.ts` (чистый модуль, без базы) — `export const DUE_WINDOW_H = 24`, `export type Due = "soon" | "late" | null`, `export function dueState(plannedAt: Date, now: Date, windowH?: number): Due`. Правило: diff < 0 → "late"; diff ≤ windowH часов → "soon"; иначе null
- Ф3: в `src/server/services/occupancy.ts` — `export const ARRIVAL_STATUSES: readonly BookingStatus[]` (ещё не заехали) и `export const DEPARTURE_STATUSES: readonly BookingStatus[]` (стоят на парковке). Ф9б строит свои списки по ним и не заводит вторую копию
- Ф3: `parkingDashboard` считает `arrivals` и `departures` через `dueState`, а не по двум календарным датам (`occupancy.ts:131,133`) — иначе плитка панели, заголовок табло и полоса доски снова дадут три разных числа
- Ф9а: `TransitionButtons.tsx` в виде после Ф9а — без состояний `timed`/`at`, без пропов `askTime` и `overstay`, без экспортов `nowMoscowLocal` и `moscowLocalToIso`. Ф9б дописывает только необязательный проп `plannedFrom` и подтверждение раннего заезда в `go()`
- Ф9а: `KanbanBoard.tsx` без блока `window.prompt` про фактическое время (строки 81-89) и без импорта из `TransitionButtons`; Ф9б правит только тип `KanbanItem` и компонент `Column`
- Ф9а: `TodayBoard.tsx` уже без пропа `overstay` у `TransitionButtons` (строка 117) — Ф9б перестраивает этот файл после неё
- Оркестратор: Ф9б запускается строго после того, как Ф9а и Ф3 слиты в `main`; если Ф3 не отдала `dueState` и списки статусов, Ф9б создаёт запасной `src/lib/due.ts`, и оркестратор при слиянии переводит `parkingDashboard` на него — двух реализаций окна 24 ч в `main` быть не должно

### 13. Ф6 — Изменение брони: сообщение и отмена старых

Дорожка Д4 · документ `PHASE_06_BOOKING_CHANGED.md` · файлов меняет: 16

**Ждёт от соседних фаз:**

- Ф4 (шаг 0, отправщик): берёт из Outbox только status = PENDING и scheduledAt <= now() — на этом держится окно тишины Ф6
- Ф4: предохранитель «не слать сообщения старше N часов» считает возраст от scheduledAt, а не от createdAt, иначе отложенное «бронь изменена» будет выглядеть протухшим
- Ф4: при успешной отправке ставит status = SENT и не трогает поле Outbox.spanKey — по нему Ф6 понимает, о каких датах клиент уже знает
- Ф4: перенос канала у PENDING при смене мессенджера не пересобирает renderedText и не меняет dedupKey
- Ф3: проверка потолка мест внутри updateBooking ставится до tx.booking.update и до вызова onBookingChanged; Ф3 сливается раньше Ф6
- Ф2б: notify(kind, text, bookingId, { tx, key }) — ключ дедупликации уведомлений администратору; Ф6 передаст key = client-has-booking:<bookingId>
- Ф7: напоминания ставятся через enqueue(..., keyPart = плановый момент), своего ключа не заводят; после смены дат сканер сам пересоздаёт напоминание — Ф6 старое отменяет
- Ф5: новые шаблоны и правила добавляются в конец TEMPLATES и rules, формат dedupKey (группа:бронь|момент) не меняют
- Ф10: changePrice, decideRecalc, waiveOverstay и начисление перестоя в transition клиенту не пишут — правило «пишем об изменении» живёт только в Ф6
- МФ-2: страница «Настройки → Сообщения» показывает messages.onBookingChanged, messages.onExtendStay, messages.changeHoldMinutes и переключатель правила on_booking_changed
- МФ-1: правки в createSiteLead не отодвигают блок уведомления «у клиента уже есть бронь» — он остаётся последним в функции, после создания брони
- Оркестратор: перенумеровать две миграции Ф6 в порядке слияния и проверить prisma migrate diff — enum трогают также Ф2б (NoticeKind) и Ф7 (AutomationTrigger)

### 14. Ф14 — Wazzup: адаптер WhatsApp и окно чатов

Дорожка Д3 · документ `PHASE_14_WAZZUP.md` · файлов меняет: 29

**Ждёт от соседних фаз:**

- Ф4 шаг 0: файл src/server/messaging/types.ts с типами SendRequest {outboxId, channel, phone: E.164, text}, SendResult = {ok:true, providerMessageId} | {ok:false, retry, code, message} и интерфейсом MessengerAdapter {code, send, availableChannels, check}
- Ф4 шаг 0: src/server/messaging/registry.ts — activeAdapter() выбирает адаптер по Setting messaging.provider и наличию ключа, при null ставит Outbox в SKIPPED_NO_PROVIDER
- Ф4 шаг 0: send() вызывается ВНЕ транзакции базы (внутри сетевой запрос), результат пишется отдельной короткой транзакцией
- Ф4 шаг 0: providerMessageId записывается в Outbox немедленно после успеха — иначе вебхук со статусом не найдёт запись
- Ф4 шаг 0: раскладка результата — ok → SENT + sentAt; ok:false и retry:false → FAILED + lastError; ok:false и retry:true → остаётся PENDING, attempts+1, повтор с нарастающей паузой; адаптер сам не повторяет и не спит
- Ф4 шаг 0: Outbox.lockedUntil и аренда записи (двойной отправки быть не должно)
- Ф4 шаг 0: предохранители — не слать сообщения старше N часов, OUTBOX_ALLOWLIST, режим «пробно»; адаптер обязан работать и при пустом allowlist
- Ф4: честная строка статуса очереди в карточке брони (bookings/[id]/page.tsx:208, время по Москве) — Ф14 дописывает к ней только «доставлено» и «прочитано»
- Ф2б: notify(kind, text, bookingId, tx, {key}) с дедупликацией и поле AdminNotice.dedupKey — для ключей client-message:<clientId> и channel-down:<transport>:<state>; до Ф2б Ф14 работает на текущем notify с проверкой непрочитанного
- Ф2б: /api/admin/notices для бейджа колокольчика — Ф14 добавит рядом счётчик неотвеченных чатов
- Ф8: слияние правок формы в BookingCalculator.tsx до того, как Ф14 добавит проп со списком доступных каналов
- МФ-3б: в CSP обязателен frame-src на домен Wazzup, иначе окно чатов погаснет; порт и заголовки — их зона
- От пользователя: аккаунт Wazzup с тарифом Pro или Max (Inbox не подходит — не даёт писать первым), ключ и секрет только в серверном .env

### 15. Ф7 — Сообщения по времени: напоминание, «не приехали»

Дорожка Д4 · документ `PHASE_07_TIMED_MESSAGES.md` · файлов меняет: 20

**Ждёт от соседних фаз:**

- Ф3: `plannedMoment(date, time, tz)` — не зависит от таймзоны процесса (смещение через Intl.formatToParts + Date.UTC, без разбора локализованной строки конструктором Date и без getHours), считает смещение в два прохода (не ошибается на час в «дыре» перехода на летнее время), принимает и Date из @db.Date, и строку YYYY-MM-DD, берёт календарную дату по UTC; поведение для несуществующего и неоднозначного настенного времени записано в тесте
- Ф3: юнит-тесты plannedMoment проходят под TZ=Asia/Jakarta; скрипт `npm run test:tz` (если его не заведёт Ф3 — заведёт Ф7)
- Ф3: проверка мест в transition/applyTransition ставится только на статусы, которые занимают место; системный переход в NO_SHOW место освобождает и проверки требовать не должен
- Ф3: освобождение «Новой заявки» через parking.newLeadHoldHours делается правилом занятости, а не сканом (иначе это второй владелец реестра сканов)
- Ф2б: реестр сканов — SCANS в scheduler.ts, принимающий несколько сканов, и чистый модуль кодов и подписей, куда Ф7 дописывает три строки
- Ф2б: setScanModeAction(code, mode) работает с любым кодом из реестра (не зашит на 'overstay') и меняет только свой ключ в Setting scheduler.scans; строки режимов в карточке «Планировщик»
- Ф6: enqueue(booking, ruleId, ruleCode, body, tx, { scheduledAt?, dedupKey? }) — с сохранением оживления записей со статусом CANCELLED и без падения тика на гонке (P2002 → оживить или вернуть null)
- Ф6: updateBooking ставит Booking.datesChangedAt при смене дат или времени (поле добавляет Ф7; если к моменту кода Ф7 строки нет, Ф7 дописывает её сама)
- Ф6: cancelPendingOutbox остаётся как есть (отменяет все PENDING) — вариант «отменять только не наступившие» отвергнут, он ломает отмену подтверждения
- Ф5: сообщение «спасибо и отзыв» через 2 часа после выезда — событийное правило STATUS_CHANGED/CHECKED_OUT с triggerParams.delayHours = 2 плюс поддержка delayHours в onStatusChanged; скана в Ф7 для него нет
- Ф4 шаг 0: отправщик берёт только записи со scheduledAt <= now и не отправляет сообщения старше N часов
- Ф4 шаг 0: строгая проверка ЧЧ:ММ при вводе времени брони (кривое время попадает в штамп ключа дедупликации)
- МФ-2: страница «Сообщения» показывает правило after_planned_checkin_24h, его часы и текст; ссылка на отзыв и признак ручной правки шаблона — там же
- Заказчик: утверждение текста «вы не приехали» (черновик — docs/MESSAGE_TEMPLATES_2026-09-22.md) и письменное подтверждение освобождения места через 48 часов

### 16. Ф11 — Касса и кассовые смены

Дорожка Д5 · документ `PHASE_11_CASH.md` · файлов меняет: 27

**Ждёт от соседних фаз:**

- Ф10: сторно ошибочного платежа оформляется ОТДЕЛЬНОЙ записью Payment в текущей открытой смене, а не правкой или удалением исходного платежа; платёж, попавший в закрытую смену, неизменяем (снимок уже сдан)
- Ф10: поле Payment.reason (причина платежа и возврата) создаёт Ф10 — Ф11 только показывает его в журнале смены и не заводит своё поле
- Ф10: у возврата сохраняется честный method — наличный возврат уменьшает кассу, возврат картой не уменьшает; способ по умолчанию не должен подменять фактический
- Ф10: реальные деньги остаются Payment.status = SUCCEEDED (в снимок смены попадают только SUCCEEDED); о любом новом статусе предупредить
- Ф10: addPayment остаётся единственной точкой записи денег; любой новый путь записи Payment (в т. ч. сторно) обязан звать shiftForPayment(tx, {kind, method}) из src/server/services/cash.ts
- Ф10: не добавлять путей удаления Payment — связь Payment → Booking переводится на onDelete: Restrict, у Payment появляется внешний ключ на CashShift
- Ф2б: сохранить совместимую сигнатуру notify(kind, text, bookingId, tx) или notify(..., { tx, key }) — Ф11 зовёт её внутри транзакции закрытия смены; дедупликация кассе не нужна
- Ф2б: при появлении фильтра уведомлений по ролям показывать CASH_MISMATCH и SHIFT_OPEN владельцу
- МФ-2: не заводить второй переключатель cash.requireShift на странице настроек — он живёт на экране кассы; при желании поставить ссылку на /admin/cash
- Ф12: читает CashShift (снимок отдельными колонками: cashIn, cardIn, transferIn, onlineIn, cashRefund, cardRefund, transferRefund, onlineRefund, collected, expectedCash, actualCash, cashDiff) и Payment.cashShiftId; список смен за период — по CashShift.shiftDate
- Ф13: читает CashShift.openedById, shiftDate, openedAt, closedAt и сама ставит отметку в табеле, в том числе задним числом по истории касс — Ф11 в табель не пишет
- МФ-3а: бэкапов по расписанию не будет (решение 23.09), поэтому перед migrate deploy Ф11 нужен ручной запуск docker/backup.sh отдельным шагом выкатки
- Оркестратору: Ф11 не трогает src/app/admin/login/actions.ts (МФ-3б) и src/components/admin/today/GuardScreen.tsx (Ф9б); в bookings/payments.ts добавляется одна вставка в addPayment, в settings.ts, Sidebar.tsx NAV и package.json — только дописывание в конец

### 17. Ф12 — Финансовый отчёт

Дорожка Д5 · документ `PHASE_12_REPORTS.md` · файлов меняет: 18

**Ждёт от соседних фаз:**

- Ф9а: checkedInAt и checkedOutAt ставит сервер в момент действия, ручного ввода нет; значение не в будущем и не раньше создания брони — отчёт якорится на checkedInAt
- Ф10: отметки отклонения не стираются задним числом — rejectedAt и rejectKind не обнуляются при подтверждении из резерва, вместо этого добавляется rejectRevokedAt DateTime? (или любой другой неизменяемый признак «была отклонена в периоде»)
- Ф10: поле Payment.reason — отдельная причина возврата вместо note; отчёт кладёт её в колонку «Причина» построчной выгрузки
- Ф10: признак сторно у ошибочного платежа (поле reversalOfId или status != SUCCEEDED), чтобы отчёт исключал его из «Получено»
- Ф10: при «забытом заезде датой без времени» момент должен попадать в московские сутки указанной даты — интервал [00:00 МСК, 24:00 МСК); рекомендуем 12:00 по Москве
- Ф11: модель CashShift с полями — кто открыл (имя), openedAt, closedAt, остаток на начало, снимок по 4 способам, возвраты, инкассации, расчётный остаток, фактический, расхождение, статус
- Ф11: функция shiftsInRange(fromIso, toIso) в src/server/services/cash.ts — принимает московские ISO-даты, возвращает смены периода по openedAt; отчёт ничего не считает сам
- Ф11: индекс Payment(kind, status, paidAt) — если Ф11 его не добавит, добавляет Ф12; двух одинаковых индексов быть не должно, решает оркестратор при слиянии
- Ф11 и Ф13: единый ответ, к какой дате относится ночная смена (вопрос 8 сверки) — отчёт обязан считать так же, иначе сверка наличных не сойдётся
- Ф3: plannedMoment остаётся в её зоне; Ф12 только дописывает moscowDayStart / moscowRange / monthStartIso в конец dates.ts. Ф3 раньше Ф12 по dashboard/page.tsx
- МФ-3б: TZ=Europe/Moscow в контейнере — после его установки числа отчёта обязаны остаться прежними (отдельный критерий приёмки)

### 18. МФ-3б — Подготовка к бою: чек-лист запуска

Дорожка Д7 · документ `PHASE_MF3B_GO_LIVE.md` · файлов меняет: 38

**Ждёт от соседних фаз:**

- МФ-3а: рабочие скрипты `docker/backup.sh`, `docker/backup-lib.sh`, `docker/backup-verify.sh`, `docker/restore.sh`, `docker/backup-offsite.sh` и `docs/RUNBOOK_BACKUP_2026-09-23.md`. МФ-3б их не переписывает: она только ставит расписание на боевом сервере, включает `BACKUP_OFFSITE` и проводит тренировку восстановления уже на бою. Нужен блок `BACKUP_*` в `.env.example` (МФ-3а дописывает его своим блоком, МФ-3б — своим, ниже).
- Ф4, шаг 0: громкий сбой seed в `docker/entrypoint.sh` — сейчас строка 7 глотает ошибку (`|| echo "seed failed (continuing)"`). МФ-3б делает seed падающим при незаданных паролях, и без правки Ф4 это падение на боевом сервере будет невидимым: контейнер стартует, пользователей нет. Если к моменту МФ-3б правка Ф4 не влилась — ревью обязано это поймать, а чек-лист требует глазами увидеть `seed ok` в логе первого запуска.
- Ф4, шаг 0: он же владеет строками `seed.ts:98-99,109` (правила `before_checkout_2d`, `after_checkout_7d`, флаг `isActive`). МФ-3б в `seed.ts` трогает только `users()` и `demo()` — ожидаю, что остальная часть файла к этому моменту уже в своём окончательном виде.
- МФ-2: страница «Пользователи и пароли» `/admin/settings/users` — именно через неё на боевом сервере ставятся боевые пароли (пункт 49 чек-листа). Отдельно ожидаю, что смена пароля гасит остальные сессии этого пользователя (`prisma.session.deleteMany({ where: { userId } })` кроме текущей). Если МФ-2 этого не делает, МФ-3б допишет две строки в её действие и укажет это в ревью.
- МФ-1 и Ф3: страница `/admin/settings/capacity` с вместимостью 405, грузовыми 10, порогом 395 и выключателем автоподтверждения — через неё выставляются боевые значения (пункты 39 и 40 чек-листа). МФ-3б в `actions/settings.ts`, `CapacityForm` и `settings.ts` не заходит вообще: все её выключатели — переменные окружения.
- Ф9б: `BookingsTable.tsx` с фильтром «Планируют выезд». МФ-3б меняет в этом файле только кнопку CSV (удаляет `exportCsv`, ставит ссылку под условием `canExport`) и добавляет два пропа в сигнатуру. Ожидаю, что фильтры Ф9б к этому моменту влиты, иначе конфликт слияния придётся разбирать руками.
- Ф11: напоминание о незакрытой кассовой смене при выходе — это тот же `src/app/admin/login/actions.ts`. МФ-3б добавляет в `loginAction` блок проверки блокировки перед обращением к паролю и не трогает `logoutAction`. Ожидаю, что Ф11 влита раньше.
- МФ-1: правки антибота в `src/app/api/public/lead/route.ts` (строка 42, опора на часы клиента). МФ-3б заменяет в этом файле только функцию `clientIp` (строки 23-25) и способ получения `ipHash` (строка 28). Ожидаю, что МФ-1 влита раньше.
- Ф14: `src/lib/tariffs.ts` строка 33 (`MAX_LINK`). МФ-3б меняет строку 30 (номер WhatsApp). МФ-3б идёт последней, конфликта быть не должно, но строки соседние — при слиянии проверить обе.
- От всех дорожек: `package.json`, `.env.example`, `tests/README.md`, `HANDOFF.md` — только дописывание в конец, как требует шаг 0 оркестратора. МФ-3б дописывает свой сценарий e2e в конец строки `test:e2e`, свой блок переменных в конец `.env.example` и свой раздел в `HANDOFF.md`.

## 3. Общие файлы: кто трогает и кто первый

Главная таблица для слияния. Файлы, за которые возьмутся две и больше фаз, — источник всех конфликтов. **Первым** идёт фаза с наименьшим номером порядка; остальные правят поверх её результата.

Файлов трогают всего: 265. Из них общих между фазами: 49.

**Три файла трогают почти все, и для них правило особое — только дописывать в конец, ничего не переставляя:** `package.json` (у каждой фазы свой сценарий e2e), `prisma/schema.prisma` (только добавляющие поля; новое значение enum — отдельной миграцией) и `prisma/seed.ts`. Папки миграций при слиянии перенумеровывает оркестратор в порядке слияния и сверяет схему с цепочкой через `prisma migrate diff`.

**Самый опасный общий файл — `src/server/services/settings.ts`:** девять фаз добавляют в него свои ключи. Ключи разные, конфликт только текстовый, но сливать его надо внимательно. `src/server/services/bookings.ts` для этого уже разрезан 23.09 на восемь модулей — именно чтобы девять фаз не дрались за один файл.

| Файл | Фаз | Кто трогает (в порядке работ) | Первый |
|---|---|---|---|
| `package.json` | 14 | Ф9а → Ф4ш0 → МФ-2 → МФ-3а → Ф3 → Ф13 → Ф10 → Ф5 → Ф8 → Ф6 → Ф7 → Ф11 → Ф12 → МФ-3б | **Ф9а** |
| `prisma/schema.prisma` | 15 | МФ-UI → Ф9а → Ф4ш0 → МФ-2 → Ф3 → Ф13 → Ф10 → Ф5 → Ф8 → Ф6 → Ф14 → Ф7 → Ф11 → Ф12 → МФ-3б | **МФ-UI** |
| `src/server/services/settings.ts` | 9 | Ф4ш0 → МФ-2 → МФ-1 → Ф3 → Ф10 → Ф8 → Ф6 → Ф7 → Ф11 | **Ф4ш0** |
| `prisma/seed.ts` | 9 | МФ-UI → Ф4ш0 → МФ-2 → Ф3 → Ф13 → Ф5 → Ф6 → Ф7 → МФ-3б | **МФ-UI** |
| `tests/README.md` | 7 | Ф4ш0 → МФ-3а → Ф13 → Ф10 → Ф7 → Ф11 → МФ-3б | **Ф4ш0** |
| `src/server/lib/dates.ts` | 6 | Ф9а → Ф4ш0 → Ф3 → Ф10 → Ф9б → Ф12 | **Ф9а** |
| `src/app/admin/actions/settings.ts` | 5 | Ф4ш0 → МФ-1 → Ф3 → Ф10 → Ф8 | **Ф4ш0** |
| `src/components/admin/nav.ts` | 6 | МФ-UI → МФ-2 → Ф13 → Ф14 → Ф11 → Ф12 | **МФ-UI** |
| `src/server/automations/dispatcher.ts` | 5 | Ф9а → Ф4ш0 → Ф5 → Ф6 → Ф7 | **Ф9а** |
| `src/server/services/bookings/transition.ts` | 5 | Ф9а → Ф3 → Ф10 → Ф5 → Ф7 | **Ф9а** |
| `prisma/templates.ts` | 4 | МФ-2 → Ф5 → Ф6 → Ф7 | **МФ-2** |
| `src/server/services/bookings/correct.ts` | 4 | Ф9а → Ф3 → Ф10 → Ф5 | **Ф9а** |
| `src/server/validation/booking.ts` | 4 | Ф9а → Ф4ш0 → Ф10 → Ф8 | **Ф9а** |
| `tests/e2e/cleanup.sql` | 4 | МФ-2 → Ф13 → Ф8 → Ф11 | **МФ-2** |
| `.env.example` | 3 | МФ-3а → Ф14 → МФ-3б | **МФ-3а** |
| `src/app/admin/actions/bookings.ts` | 3 | Ф9а → Ф3 → Ф10 | **Ф9а** |
| `src/app/api/public/lead/route.ts` | 3 | МФ-1 → Ф8 → МФ-3б | **МФ-1** |
| `src/components/BookingCalculator.tsx` | 3 | Ф8 → Ф6 → Ф14 | **Ф8** |
| `src/components/admin/today/TodayBoard.tsx` | 4 | МФ-UI → Ф9а → Ф3 → Ф9б | **МФ-UI** |
| `src/server/services/bookings/edit.ts` | 3 | Ф3 → Ф6 → Ф7 | **Ф3** |
| `src/server/services/bookings/payments.ts` | 3 | Ф3 → Ф10 → Ф11 | **Ф3** |
| `src/server/services/leads.ts` | 3 | МФ-1 → Ф8 → Ф6 | **МФ-1** |
| `tests/unit/dates.test.ts` | 3 | Ф9а → Ф10 → Ф9б | **Ф9а** |
| `HANDOFF.md` | 2 | МФ-3а → МФ-3б | **МФ-3а** |
| `src/app/admin/actions/clients.ts` | 2 | Ф4ш0 → Ф8 | **Ф4ш0** |
| `src/app/admin/today/page.tsx` | 3 | МФ-UI → Ф3 → Ф9б | **МФ-UI** |
| `src/components/admin/AdminShell.tsx` | 3 | МФ-UI → Ф9б → Ф11 | **МФ-UI** |
| `src/components/admin/QuickBookingDrawer.tsx` | 2 | Ф3 → Ф9б | **Ф3** |
| `src/components/admin/TodayStrip.tsx` | 2 | Ф3 → Ф9б | **Ф3** |
| `src/components/admin/booking/EditBooking.tsx` | 2 | Ф3 → Ф6 | **Ф3** |
| `src/components/admin/booking/StatusCorrect.tsx` | 2 | Ф9а → Ф10 | **Ф9а** |
| `src/components/admin/booking/TransitionButtons.tsx` | 2 | Ф9а → Ф9б | **Ф9а** |
| `src/components/admin/kanban/BookingsTable.tsx` | 2 | Ф9б → МФ-3б | **Ф9б** |
| `src/components/admin/kanban/KanbanBoard.tsx` | 2 | Ф9а → Ф9б | **Ф9а** |
| `src/components/admin/Topbar.tsx` | 2 | МФ-UI → Ф9б | **МФ-UI** |
| `src/components/admin/today/GuardScreen.tsx` | 2 | МФ-UI → Ф9б | **МФ-UI** |
| `src/lib/crm/labels.ts` | 2 | МФ-UI → Ф9б | **МФ-UI** |
| `src/app/admin/login/actions.ts` | 2 | МФ-UI → МФ-3б | **МФ-UI** |
| `src/components/admin/settings/CapacityForm.tsx` | 2 | МФ-1 → Ф3 | **МФ-1** |
| `src/lib/crm/automation-labels.ts` | 2 | МФ-2 → Ф5 | **МФ-2** |
| `src/lib/moscow.ts` | 2 | Ф9а → Ф9б | **Ф9а** |
| `src/proxy.ts` | 2 | Ф14 → МФ-3б | **Ф14** |
| `src/server/automations/scheduler.ts` | 2 | Ф4ш0 → Ф7 | **Ф4ш0** |
| `src/server/services/autoconfirm.ts` | 2 | МФ-1 → Ф3 | **МФ-1** |
| `src/server/services/bookings/create.ts` | 2 | МФ-1 → Ф3 | **МФ-1** |
| `src/server/services/bookings/index.ts` | 2 | МФ-1 → Ф7 | **МФ-1** |
| `src/server/services/bookings/queries.ts` | 2 | Ф10 → МФ-3б | **Ф10** |
| `src/server/services/bookings/shared.ts` | 2 | Ф3 → Ф10 | **Ф3** |
| `tests/e2e/cleanup.mjs` | 2 | Ф13 → Ф11 | **Ф13** |
| `tests/e2e/crm-pipeline.mjs` | 2 | Ф9а → Ф10 | **Ф9а** |
| `tests/e2e/overstay.mjs` | 2 | Ф9а → Ф10 | **Ф9а** |
| `tests/e2e/site-lead.mjs` | 2 | Ф4ш0 → МФ-1 | **Ф4ш0** |
| `tests/unit/render.test.ts` | 2 | Ф5 → Ф7 | **Ф5** |

<details><summary>Файлы, которые трогает ровно одна фаза (216)</summary>

| Файл | Фаза |
|---|---|
| `.gitignore` | МФ-3а |
| `docker-compose.yml` | МФ-3б |
| `docker/anonymize.sh` | МФ-3а |
| `docker/anonymize.sql` | МФ-3а |
| `docker/backup-lib.sh` | МФ-3а |
| `docker/backup-offsite.sh` | МФ-3а |
| `docker/backup-verify.sh` | МФ-3а |
| `docker/backup.sh` | МФ-3а |
| `docker/entrypoint.sh` | Ф4ш0 |
| `docker/restore.sh` | МФ-3а |
| `docs/RUNBOOK_BACKUP_2026-09-23.md` | МФ-3а |
| `docs/RUNBOOK_GOLIVE_2026-09-23.md` | МФ-3б |
| `docs/WAZZUP_INTEGRATION.md` | Ф14 |
| `docs/phases/PHASE_04_SENDER.md` | Ф4ш0 |
| `docs/phases/PHASE_07_TIMED_MESSAGES.md` | Ф7 |
| `docs/phases/PHASE_09A_NO_MANUAL_TIME.md` | Ф9а |
| `docs/phases/PHASE_09B_BOARD_FILTERS_MSK.md` | Ф9б |
| `docs/phases/PHASE_10_MONEY.md` | Ф10 |
| `docs/phases/PHASE_12_REPORTS.md` | Ф12 |
| `docs/phases/PHASE_13_TIMESHEET.md` | Ф13 |
| `docs/phases/PHASE_MF2_SETTINGS.md` | МФ-2 |
| `docs/phases/PHASE_MF3A_BACKUPS.md` | МФ-3а |
| `next.config.ts` | МФ-3б |
| `prisma/migrations/*_report_indexes/migration.sql` | Ф12 |
| `prisma/migrations/2026MMDDHHMMSS_settings_edit_marks/migration.sql` | МФ-2 |
| `prisma/migrations/<enum>/migration.sql` | Ф7 |
| `prisma/migrations/<fields>/migration.sql` | Ф7 |
| `prisma/migrations/<timestamp>_consent_events/migration.sql` | Ф8 |
| `prisma/migrations/<timestamp>_staff_timesheet/migration.sql` | Ф13 |
| `prisma/migrations/<ts>_booking_changed_enums/migration.sql` | Ф6 |
| `prisma/migrations/<ts>_booking_contract_number/migration.sql` | Ф5 |
| `prisma/migrations/<ts>_cash_shifts/migration.sql` | Ф11 |
| `prisma/migrations/<ts>_money_fields/migration.sql` | Ф10 |
| `prisma/migrations/<ts>_outbox_sender_enums/migration.sql` | Ф4ш0 |
| `prisma/migrations/<ts>_outbox_sender_fields/migration.sql` | Ф4ш0 |
| `prisma/migrations/<ts>_outbox_span_key/migration.sql` | Ф6 |
| `prisma/migrations/<ts>_payment_void_enum/migration.sql` | Ф10 |
| `prisma/migrations/<метка>_checkin_checkout_date_only/migration.sql` | Ф9а |
| `prisma/migrations/<метка>_driver_parker_roles/migration.sql` | МФ-UI |
| `prisma/migrations/<метка>_login_attempt/migration.sql` | МФ-3б |
| `scripts/backup-pull.sh` | МФ-3а |
| `scripts/launchd/com.parking24.backup.plist.example` | МФ-3а |
| `src/app/admin/actions/cash.ts` | Ф11 |
| `src/app/admin/actions/contract.ts` | Ф5 |
| `src/app/admin/actions/links.ts` | МФ-2 |
| `src/app/admin/actions/messaging.ts` | Ф14 |
| `src/app/admin/actions/staff.ts` | Ф13 |
| `src/app/admin/actions/tariffs.ts` | МФ-2 |
| `src/app/admin/actions/templates.ts` | МФ-2 |
| `src/app/admin/actions/users.ts` | МФ-2 |
| `src/app/admin/(app)/layout.tsx` | МФ-UI (не меняет — регистрирует: ролевой шлюз всей группы `(app)`, до 24.09 в карте отсутствовал) |
| `src/app/admin/login/page.tsx` | МФ-UI |
| `src/app/admin/parking-lot/page.tsx` | МФ-UI |
| `src/app/admin/transfers/page.tsx` | МФ-UI |
| `src/app/api/admin/chats/unanswered/route.ts` | Ф14 |
| `src/app/api/admin/export/bookings/route.ts` | МФ-3б |
| `src/app/api/health/route.ts` | МФ-3б |
| `src/app/api/public/flags/route.ts` | Ф8 |
| `src/app/api/webhooks/wazzup/[secret]/route.ts` | Ф14 |
| `src/app/globals.css` | Ф12 |
| `src/app/layout.tsx` | МФ-3б |
| `src/app/policy/page.tsx` | МФ-3б |
| `src/app/robots.ts` | МФ-3б |
| `src/app/sitemap.ts` | МФ-3б |
| `src/components/ChannelPicker.tsx` | Ф14 |
| `src/components/admin/ChatPanel.tsx` | Ф14 |
| `src/components/admin/Clock.tsx` | Ф9б |
| `src/components/admin/GlobalSearch.tsx` | МФ-UI |
| `src/components/admin/MobileNav.tsx` | МФ-UI |
| `src/components/admin/Sidebar.tsx` | МФ-UI |
| `src/components/admin/field/ParkingLotScreen.tsx` | МФ-UI |
| `src/components/admin/field/TransferScreen.tsx` | МФ-UI |
| `src/components/admin/LogoutButton.tsx` | Ф11 |
| `src/components/admin/OutboxList.tsx` | Ф4ш0 |
| `src/components/admin/booking/PaymentPanel.tsx` | Ф10 |
| `src/components/admin/booking/PriceTools.tsx` | Ф10 |
| `src/components/admin/cash/CloseShiftForm.tsx` | Ф11 |
| `src/components/admin/cash/CollectionForm.tsx` | Ф11 |
| `src/components/admin/cash/OpenShiftForm.tsx` | Ф11 |
| `src/components/admin/cash/RequireShiftSwitch.tsx` | Ф11 |
| `src/components/admin/cash/ShiftPanel.tsx` | Ф11 |
| `src/components/admin/cash/ShiftReport.tsx` | Ф11 |
| `src/components/admin/client/ConsentPanel.tsx` | Ф8 |
| `src/components/admin/clients/SegmentExport.tsx` | Ф8 |
| `src/components/admin/kanban/BookingCard.tsx` | Ф9б |
| `src/components/admin/occupancy/ParkingSummary.tsx` | Ф3 |
| `src/components/admin/reports/PeriodPicker.tsx` | Ф12 |
| `src/components/admin/reports/PrintButton.tsx` | Ф12 |
| `src/components/admin/reports/ReportView.tsx` | Ф12 |
| `src/components/admin/settings/AutoConfirmPanel.tsx` | МФ-1 |
| `src/components/admin/settings/ContractCard.tsx` | Ф5 |
| `src/components/admin/settings/LinksForm.tsx` | МФ-2 |
| `src/components/admin/settings/MessagingCard.tsx` | Ф14 |
| `src/components/admin/settings/MoneyCard.tsx` | Ф10 |
| `src/components/admin/settings/PasswordCard.tsx` | МФ-2 |
| `src/components/admin/settings/PolicyForm.tsx` | МФ-2 |
| `src/components/admin/settings/RuleRow.tsx` | МФ-2 |
| `src/components/admin/settings/SenderCard.tsx` | Ф4ш0 |
| `src/components/admin/settings/SettingsBack.tsx` | МФ-2 |
| `src/components/admin/settings/TariffsForm.tsx` | МФ-2 |
| `src/components/admin/settings/TemplateCard.tsx` | МФ-2 |
| `src/components/admin/settings/UsersPanel.tsx` | МФ-2 |
| `src/components/admin/staff/CellPicker.tsx` | Ф13 |
| `src/components/admin/staff/MonthSummary.tsx` | Ф13 |
| `src/components/admin/staff/PeopleEditor.tsx` | Ф13 |
| `src/components/admin/staff/PrintButton.tsx` | Ф13 |
| `src/components/admin/staff/ShiftGrid.tsx` | Ф13 |
| `src/lib/antibot.ts` | МФ-1 |
| `src/lib/autoconfirm-gate.ts` | МФ-1 |
| `src/lib/automations/rules.ts` | Ф5 |
| `src/lib/booking-change.ts` | Ф6 |
| `src/lib/cash.ts` | Ф11 |
| `src/lib/consent.ts` | Ф8 |
| `src/lib/contract.ts` | Ф5 |
| `src/lib/correction.ts` | Ф9а |
| `src/lib/csv.ts` | МФ-3б |
| `src/lib/due.ts` | Ф9б |
| `src/lib/login-lock.ts` | МФ-3б |
| `src/lib/occupancy-math.ts` | Ф3 |
| `src/lib/overstay.ts` | Ф9а |
| `src/lib/periods.ts` | Ф4ш0 |
| `src/lib/recalc.ts` | Ф10 |
| `src/lib/refund.ts` | Ф10 |
| `src/lib/report-math.ts` | Ф12 |
| `src/lib/segments.ts` | Ф8 |
| `src/lib/settings-validate.ts` | МФ-2 |
| `src/lib/tariffs.ts` | МФ-3б |
| `src/lib/workshift.ts` | Ф13 |
| `src/server/auth/guard.ts` | МФ-UI |
| `src/server/auth/login-guard.ts` | МФ-3б |
| `src/server/auth/session.ts` | МФ-3б |
| `src/server/automations/adapters/index.ts` | Ф4ш0 |
| `src/server/automations/preview.ts` | МФ-2 |
| `src/server/automations/render.ts` | МФ-2 |
| `src/server/automations/scans/checkin.ts` | Ф7 |
| `src/server/automations/sender-core.ts` | Ф4ш0 |
| `src/server/automations/sender.ts` | Ф4ш0 |
| `src/server/automations/tick-core.ts` | Ф4ш0 |
| `src/server/automations/timing.ts` | Ф7 |
| `src/server/lib/client-ip.ts` | МФ-3б |
| `src/server/lib/config.ts` | МФ-3б |
| `src/server/lib/webhook-auth.ts` | Ф14 |
| `src/server/messaging/types.ts` | Ф14 |
| `src/server/messaging/wazzup/adapter.ts` | Ф14 |
| `src/server/messaging/wazzup/channels.ts` | Ф14 |
| `src/server/messaging/wazzup/client.ts` | Ф14 |
| `src/server/messaging/wazzup/errors.ts` | Ф14 |
| `src/server/messaging/wazzup/iframe.ts` | Ф14 |
| `src/server/messaging/wazzup/inbound.ts` | Ф14 |
| `src/server/messaging/wazzup/setup.ts` | Ф14 |
| `src/server/services/audit.ts` | МФ-3б |
| `src/server/services/automations.ts` | МФ-2 |
| `src/server/services/cash.ts` | Ф11 |
| `src/server/services/clients.ts` | Ф8 |
| `src/server/services/consent.ts` | Ф8 |
| `src/server/services/contract.ts` | Ф5 |
| `src/server/services/dialogs.ts` | Ф14 |
| `src/server/services/occupancy.ts` | Ф3 |
| `src/server/services/outbox.ts` | Ф4ш0 |
| `src/server/services/policy.ts` | МФ-2 |
| `src/server/services/pricing.ts` | Ф10 |
| `src/server/services/recalc.ts` | Ф10 |
| `src/server/services/reports.ts` | Ф12 |
| `src/server/services/segments.ts` | Ф8 |
| `src/server/services/staff.ts` | Ф13 |
| `src/server/services/tariff-admin.ts` | МФ-2 |
| `src/server/services/today.ts` | МФ-UI |
| `src/server/services/templates.ts` | МФ-2 |
| `src/server/services/users.ts` | МФ-2 |
| `src/server/validation/cash.ts` | Ф11 |
| `tests/e2e/autoconfirm.mjs` | МФ-1 |
| `tests/e2e/board24.mjs` | Ф9б |
| `tests/e2e/booking-change.mjs` | Ф6 |
| `tests/e2e/capacity.mjs` | Ф3 |
| `tests/e2e/cash.mjs` | Ф11 |
| `tests/e2e/f9a-no-manual-time.mjs` | Ф9а |
| `tests/e2e/hardening.mjs` | МФ-3б |
| `tests/e2e/lib.mjs` | Ф7 |
| `tests/e2e/messages.mjs` | Ф5 |
| `tests/e2e/mf2-settings.mjs` | МФ-2 |
| `tests/e2e/money.mjs` | Ф10 |
| `tests/e2e/reports.mjs` | Ф12 |
| `tests/e2e/roles.mjs` | МФ-UI |
| `tests/e2e/segment.mjs` | Ф8 |
| `tests/e2e/sender.mjs` | Ф4ш0 |
| `tests/e2e/staff.mjs` | Ф13 |
| `tests/e2e/timed.mjs` | Ф7 |
| `tests/e2e/wazzup.mjs` | Ф14 |
| `tests/mocks/wazzup-mock.mjs` | Ф14 |
| `tests/unit/antibot.test.ts` | МФ-1 |
| `tests/unit/autoconfirm-gate.test.ts` | МФ-1 |
| `tests/unit/automation-rules.test.ts` | Ф5 |
| `tests/unit/automation-timing.test.ts` | Ф7 |
| `tests/unit/backup-sh.test.ts` | МФ-3а |
| `tests/unit/booking-change.test.ts` | Ф6 |
| `tests/unit/capacity.test.ts` | Ф3 |
| `tests/unit/cash.test.ts` | Ф11 |
| `tests/unit/client-ip.test.ts` | МФ-3б |
| `tests/unit/config.test.ts` | МФ-3б |
| `tests/unit/consent.test.ts` | Ф8 |
| `tests/unit/contract.test.ts` | Ф5 |
| `tests/unit/correction.test.ts` | Ф9а |
| `tests/unit/csv.test.ts` | МФ-3б |
| `tests/unit/due.test.ts` | Ф9б |
| `tests/unit/login-lock.test.ts` | МФ-3б |
| `tests/unit/moscow.test.ts` | Ф9б |
| `tests/unit/occupancy-math.test.ts` | Ф3 |
| `tests/unit/overstay.test.ts` | Ф9а |
| `tests/unit/planned-moment.test.ts` | Ф3 |
| `tests/unit/recalc.test.ts` | Ф10 |
| `tests/unit/refund.test.ts` | Ф10 |
| `tests/unit/report-math.test.ts` | Ф12 |
| `tests/unit/report-range.test.ts` | Ф12 |
| `tests/unit/robots-sitemap.test.ts` | МФ-3б |
| `tests/unit/roles.test.ts` | МФ-UI |
| `tests/unit/rule-when.test.ts` | МФ-2 |
| `tests/unit/seed-flags.test.ts` | МФ-3б |
| `tests/unit/seed-sync.test.ts` | МФ-2 |
| `tests/unit/segments.test.ts` | Ф8 |
| `tests/unit/sender.test.ts` | Ф4ш0 |
| `tests/unit/settings-validate.test.ts` | МФ-2 |
| `tests/unit/tariff-rules.test.ts` | МФ-2 |
| `tests/unit/template-vars.test.ts` | МФ-2 |
| `tests/unit/user-rules.test.ts` | МФ-2 |
| `tests/unit/wazzup.test.ts` | Ф14 |
| `tests/unit/workshift.test.ts` | Ф13 |

</details>

## 4. Где что лежит

| Документ | Что в нём |
|---|---|
| `docs/TZ_2026-09-21_SOURCE.md` | ТЗ заказчика, исходный текст |
| `docs/TZ_2026-09-21_PLAN.md` | **§1 решения пользователя — закон**, §3 правила проекта, §4 схема, §5а таблица фаз |
| `docs/TZ_STATUS_2026-09-22_night.md` | Сверка с ТЗ по коду: §1 цифры, §2 дыры на stage, §3 по фазам, §4 зависимости |
| `docs/phases/DECISIONS_2026-09-24.md` | **Решения по 216 вопросам архитектур**: расхождения между фазами сведены к одному правилу |
| `docs/phases/QUESTIONS_2026-09-23.md` | Все вопросы с вариантами и рекомендациями, сырым списком |
| `docs/phases/MAP_DEPENDENCIES.md` | Этот файл |
| `docs/phases/PHASE_*.md` | Архитектура фазы + независимая критика в конце каждого |
| `tests/README.md` | Как запускать тесты и подводные камни |

**Порядок чтения для нового агента:** PLAN §1 и §3 → MAP (этот файл) → DECISIONS → документ своей фазы целиком, включая раздел критики в конце.

