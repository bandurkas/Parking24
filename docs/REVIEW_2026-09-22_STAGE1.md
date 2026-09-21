# Код-ревью этапа 1 и текстов сообщений (22.09.2026)

Первый, независимый раунд по правилу пользователя: независимое ревью → правки → подтверждающее ревью.

Ревьюировались коммиты `99abd0e` (этап 1, уже на stage) и `cfdcae4` (рендер сообщений), плюс незакоммиченная `siteLinks`. Шесть направлений: конкурентность, арифметика занятости, статусы, настройки и права, рендер сообщений, интерфейс. Каждая находка уровня «блокер» и «важно» проверялась двумя враждебными проверками — прогон сценария по коду и сверка цитаты с файлом; проверяющим велено опровергать по умолчанию.

Находок: **41** — блокеров 6, важных 25, мелочей 10.

Важно: ревьюеры вышли за границы двух коммитов и нашли расхождения на стыке нового кода со старым — например, что проверка мест в CRM осталась по старой ёмкости. Это не выход за рамки, а то самое, ради чего делается независимое ревью.


> **Проверку прошли не все.** Сессия закончилась раньше, чем вернулись последние проверяющие, и критик полноты («что ревью пропустило») не запускался вовсе. Находки ниже помечены ⏳ — их никто не пытался опровергнуть, относиться к ним как к неподтверждённым:
>
> - src/app/admin/(app)/bookings/[id]/page.tsx:47 — Карточка брони не считает REJECTED терминальным: полоса этапов показывает отклонённую заявку как несозданную
> - src/app/admin/(app)/clients/[id]/page.tsx:163 — В карточке клиента отклонённая бронь показывается как долг
> - src/app/admin/(app)/settings/capacity/page.tsx:23 — «Сейчас занято мест» на странице ёмкости считает фуры вместе с общим пулом
> - src/app/admin/actions/settings.ts:47 — markNoticesReadAction без проверки роли — охрана может погасить уведомления владельца
> - src/app/admin/actions/settings.ts:22 — Вместимость сохраняется без сверки с текущей занятостью — опечатка молча закрывает приём заявок
> - src/components/BookingCalculator.tsx:196 — При повторной отправке заголовок карточки противоречит шагам: «Заявка уже у администратора» при уже подтверждённой броне
> - src/components/admin/AdminShell.tsx:9 — Уведомления читаются в layout, а layout в Next 16.3 не перерисовывается при переходах — бейдж застывает на всю сессию
> - src/components/admin/occupancy/ParkingSummary.tsx:25 — Порог автоподтверждения сверяется не с той величиной: held включает фуры и считается только на сегодня
> - src/server/automations/render.ts:41 — Сумма выводится двумя разными способами: «1050 ₽» в одном сообщении и «1 050 ₽» в другом
> - src/server/lib/dates.ts:64 — plannedMoment зависит от таймзоны процесса: в «дыре» перехода на летнее время локальной TZ ошибается на час
> - src/server/services/autoconfirm.ts:52 — В условиях автоподтверждения нет проверки «цена больше нуля», которую требует план
> - src/server/services/settings.ts:57 — siteLinks опирается на NEXT_PUBLIC_SITE_URL, который на stage вшит пустым на этапе сборки
>
> Мелочи на проверку не отправлялись по замыслу.


## Блокер (6)


### prisma/seed.ts:88 — Боевые шаблоны в базе не переведены на greeting.* — безымянная бронь даёт «Здравствуйте,!» и «, место подтверждено!»

*✅ подтверждено* · направление: render

**Что происходит.** Админ заводит бронь в быстром окне CRM без имени (поле подписано «Имя (необязательно)», QuickBookingDrawer.tsx:210) и ставит статус CONFIRMED → правило on_confirmed → шаблон booking_confirmed. Прогнал этот body через renderTemplate с client=null и contactName=null: «Здравствуйте,! Бронь №42 подтверждена: 17 сент → 19 сент, Легковая…». Шаблон awaiting_payment (seed.ts:94, `sync: true`, перезаписывается при каждом сиде) даёт сообщение, начинающееся с запятой: «, место подтверждено! Бронь №42…». Правило `/ +([,.!?:;])/` не чинит, а ухудшает: «Здравствуйте, !» превращается в «Здравствуйте,!». Именно от этого в cfdcae4 сделаны `greeting.hello`/`greeting.name` и тест render.test.ts:52, но тексты редакции 3 живут только в docs: в src нет ни одного обращения к `messageTemplate` (админки шаблонов нет), единственный источник тел шаблонов — seed.ts, и он остался на редакции 1.

**В коде.** `{ code: "booking_confirmed", name: "Подтверждение брони", body: "Здравствуйте, {{client.name}}! Бронь №{{booking.number}} подтверждена: ..." }`

**Правка.** Перенести тексты из docs/MESSAGE_TEMPLATES_2026-09-22.md в seed.ts, заменив «Здравствуйте, {{client.name}}!» на `{{greeting.hello}}` и «{{client.name}}, » на `{{greeting.name}}`, и пометить эти шаблоны `sync: true`, иначе upsert не обновит уже существующие строки.

- проверка «воспроизведение»: подтверждает (высокая) — Прошёл сценарий по файлам, ни одна проверка дефект не гасит; результат воспроизвёл запуском renderTemplate на реальных телах из seed.ts.  Цепочка вызовов: 1. /Users/styserg/Parking24/src/components/admin/QuickBookingDrawer.tsx:210 — `placeholder="Имя (необязательно)"`, там же :47 `const [status, setStatus] = useState<"NEW" \| "CONFIRMED">("NEW")` и :127 отправка `{ phone, name, ..., status }`. Зна
- проверка «чтение-кода»: подтверждает (высокая) — Попытался опровергнуть — не вышло, все пять проверяемых утверждений подтвердились дословно.  1) Цитата и строка точные. `/Users/styserg/Parking24/prisma/seed.ts:88`: `{ code: "booking_confirmed", name: "Подтверждение брони", body: "Здравствуйте, {{client.name}}! Бронь №{{booking.number}} подтверждена: {{booking.dates}}, {{booking.vehicle}}. Адрес: ... До встречи!" }` — без `sync`, то есть `update:

### src/app/admin/(app)/boards/[kind]/page.tsx:28 — Запрос доски не выбирает статус REJECTED — отклонённые заявки не видны ни на канбане, ни в таблице

*✅ подтверждено* · направление: statuses

**Что происходит.** Автоподтверждение включено, свободных мест нет → заявка с сайта создаётся в статусе REJECTED. Оба условия OR в запросе перечисляют статусы поимённо и REJECTED нет ни в активном списке (NEW/AWAITING_PAYMENT/CONFIRMED/CHECKED_IN), ни в терминальном (CHECKED_OUT/CANCELLED/NO_SHOW). Строка не попадает в rows → карточки нет ни на доске, ни в таблице (ни с фильтром, ни без). Администратор может открыть заявку только по ссылке из колокольчика; после нажатия «Прочитано» (markNoticesRead помечает все уведомления сразу) единственный оставшийся путь — глобальный поиск по номеру/телефону. Возврат брони из резерва (REJECTED → «Ожидает оплаты»), ради которого статус и заводился, из основного рабочего экрана недостижим — живой клиент с заявкой теряется. План, п. «Этап 1» прямо требует: «Статус «Отклонена»: enum, подписи, колонка на доске, переходы».

**В коде.** `OR: [   { status: { in: ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] } },   { status: { in: ["CHECKED_OUT", "CANCELLED", "NO_SHOW"] }, updatedAt: { gte: toDate(addDays(today, -14)) } }, ],`

**Правка.** Добавить "REJECTED" во второй список статусов (терминальные за последние 14 дней): { status: { in: ["CHECKED_OUT", "CANCELLED", "NO_SHOW", "REJECTED"] }, updatedAt: {...} }.

- проверка «воспроизведение»: подтверждает (высокая) — Прошёл цепочку по файлам, ни на одном шаге нет проверки, которая бы не дала дефекту проявиться.  1) `src/server/services/autoconfirm.ts:59` — `return { status: "REJECTED", reason: "no_space", peak, limit: s.autoConfirmLimit };` когда `fits(...)` ложно. 2) `src/server/services/leads.ts:78` передаёт этот статус в `createBooking` через decider; `src/server/services/bookings.ts:35` `const status = dec
- проверка «чтение-кода»: подтверждает (высокая) — Цитата совпадает с файлом дословно. src/app/admin/(app)/boards/[kind]/page.tsx строки 26-29: `OR: [ { status: { in: ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] } }, { status: { in: ["CHECKED_OUT", "CANCELLED", "NO_SHOW"] }, updatedAt: { gte: toDate(addDays(today, -14)) } }, ]`. В enum BookingStatus 8 значений (prisma/schema.prisma:44 добавляет REJECTED), перечислено 7, REJECTED — единст

### src/app/api/public/lead/route.ts:42 — Антибот-отсечка отвечает «ok» без state — калькулятор рисует полную карточку «Заявка принята», хотя заявки нет

*❌ опровергнуто проверкой* · направление: ui

**Что происходит.** Строка сама по себе предсуществующая (blame 0eb2bbb, 05.09), но в этих коммитах она стала противоречить новому контракту: клиент с часами, убежавшими вперёд хотя бы на пару секунд (обычная ситуация на телефоне без NTP), присылает ts = Date.now() клиента; на сервере Date.now() − d.ts выходит отрицательным, условие < 1500 истинно ВСЕГДА, ответ {ok:true} без number и без state. В BookingCalculator (строки 175–176) confirmed=false, rejected=false → рисуется ветка pending: «Заявка принята», «Администратор проверяет место · Обычно 5–10 минут», «Подтверждение придёт в WhatsApp на +7 …». Брони в базе нет, уведомления админу нет, номера нет. Клиент уезжает в аэропорт, считая место занятым. Для такого посетителя это не разовый сбой, а постоянная чёрная дыра: каждая попытка отправки даёт тот же «успех».

**В коде.** `if (d.ts && Date.now() - d.ts < 1500) return NextResponse.json({ ok: true });`

**Правка.** Не отвечать «ok» вслепую. Минимум: вернуть в этом ответе state: "pending" нельзя (заявки нет) — нужно либо честно создавать заявку и помечать её подозрительной, либо возвращать {ok:false, error} и показывать клиенту ошибку. И убрать зависимость от часов клиента: сравнивать не с ts из тела, а с временем выдачи страницы (подписанный серверный токен/кука) или отсекать только заведомо ботовые значения (Date.now() - d.ts < 0 трактовать как «часы врут», а не как бота).

- проверка «воспроизведение»: опровергает (высокая) — Прошёл цепочку по файлам, шаг за шагом.  1) `BookingCalculator.submit()` (src/components/BookingCalculator.tsx:139) шлёт `ts: mountedAt.current`, где `mountedAt.current = Date.now()` из `useEffect` (строки 111–114) — это часы КЛИЕНТА в момент монтирования. 2) route.ts:37 `leadSchema.safeParse` → `ts: z.coerce.number().optional()` (src/server/validation/booking.ts:42) — нижней границы нет, отрицате
- проверка «чтение-кода»: опровергает (высокая) — Цитата и строка совпадают точно — src/app/api/public/lead/route.ts:42 действительно `if (d.ts && Date.now() - d.ts < 1500) return NextResponse.json({ ok: true });`. По моему углу проверки находка не опровергается. Но она разваливается на двух других проверяемых по файлам утверждениях.  (1) «В ЭТИХ КОММИТАХ она стала противоречить новому контракту» — неверно. Я сравнил рендер до и после. `git show 

### src/components/admin/kanban/KanbanBoard.tsx:21 — На канбане нет колонки «Отклонена», и карточка с этим статусом молча выбрасывается

*✅ подтверждено* · направление: statuses

**Что происходит.** Даже после починки запроса доски карточка не появится: COLUMNS = [...PIPELINE, "CANCELLED"] (PIPELINE не содержит REJECTED), карта byStatus заполняется только ключами из COLUMNS, а на строке 48 к колонке CANCELLED приводится только NO_SHOW. Для брони со статусом REJECTED col = "REJECTED", m.get("REJECTED") возвращает undefined, и `?.push(it)` тихо ничего не делает — ни ошибки, ни карточки. Счётчики колонок и суммы тоже не сходятся с числом загруженных броней. Требование плана «колонка на доске» не выполнено.

**В коде.** `const COLUMNS: BookingStatus[] = [...PIPELINE, "CANCELLED"]; ... const col = it.status === "NO_SHOW" ? "CANCELLED" : it.status; m.get(col)?.push(it);`

**Правка.** Добавить колонку: const COLUMNS = [...PIPELINE, "REJECTED", "CANCELLED"] и подпись колонки (isTerminal сейчас жёстко проверяет status === "CANCELLED" и печатает «Отменена / No-show»); либо, если отдельной колонки не хотим, явно приводить REJECTED к существующей колонке в строке 48, но тогда требование плана остаётся невыполненным.

- проверка «воспроизведение»: подтверждает (высокая) — Проверил по файлам, ядро находки подтверждается. `src/lib/crm/labels.ts:48`: `export const PIPELINE: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];` — REJECTED там нет. `KanbanBoard.tsx:21`: `const COLUMNS: BookingStatus[] = [...PIPELINE, "CANCELLED"];`, значит ключи `byStatus` — ровно эти шесть, а строка 48 приводит к CANCELLED только NO_SHOW: `const col 
- проверка «чтение-кода»: подтверждает (высокая) — Проверил построчно, цитаты совпадают с файлом дословно.  /Users/styserg/Parking24/src/components/admin/kanban/KanbanBoard.tsx:21 — `const COLUMNS: BookingStatus[] = [...PIPELINE, "CANCELLED"];` /Users/styserg/Parking24/src/lib/crm/labels.ts:48 — `export const PIPELINE: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];` — REJECTED в PIPELINE действительно нет.

### src/server/automations/dispatcher.ts:28 — Единственный боевой вызов renderTemplate не передаёт extras — в текстах редакции 3 остаются висящие подписи «Маршрут:», «Договор №», «Принят:»

*✅ подтверждено* · направление: render

**Что происходит.** Прогнал шаблоны 1, 3 и 4 из docs/MESSAGE_TEMPLATES_2026-09-22.md ровно так, как их зовёт диспетчер — `renderTemplate(body, { booking, client })`, без третьего аргумента. Получилось дословно: «Адрес: Московская область, г.о. Химки, село Чашниково.\nМаршрут:» (пусто), «Бронь № 42\nДоговор №\nАвтомобиль: Легковая А123ВС77\nПринят:», «Будем благодарны за отзыв, это займёт минуту:» (пусто). Переменные `links.route`, `links.review`, `booking.contract`, `booking.checkedInAt` берутся ТОЛЬКО из `extras` (render.ts:32, 38, 51–52), а `extras` не передаёт никто, кроме тестов (grep по renderTemplate: один боевой вызов). Новый помощник `siteLinks()` из незакоммиченной правки settings.ts:50 тоже никуда не подключён. Чистка пустых переменных здесь не спасает: правило `/ +([,.!?:;])/` убирает пробел ПЕРЕД знаком, а в реальных текстах подпись стоит ПЕРЕД переменной, поэтому двоеточие и «№» остаются. Тест render.test.ts:43 проверяет обратный порядок («{{unknown}} ,»), которого в шаблонах нет, — отсюда ложная уверенность.

**В коде.** `const renderedText = renderTemplate(templateBody, { booking, client });`

**Правка.** В `enqueue` собрать extras и передать третьим аргументом: `renderTemplate(templateBody, { booking, client }, { ...(await siteLinks()), contract: booking.contractNo ?? null, checkedInAt: booking.checkedInAt ? fmtDateTime(booking.checkedInAt) : null })`; дополнительно в render.ts после подстановки выбрасывать строку, которая после trim заканчивается на «:» или «№» (подпись без значения).

- проверка «воспроизведение»: подтверждает (высокая) — Проверил по файлам, находка подтверждается в своей кодовой части. Единственный боевой вызов — dispatcher.ts:28 `const renderedText = renderTemplate(templateBody, { booking, client });` (grep по renderTemplate даёт только его и тесты), поэтому в render.ts:20 срабатывает дефолт `extras: RenderExtras = {}`, и render.ts:32,38,51,52 (`extras.contract ?? ""`, `extras.checkedInAt ?? ""`, `extras.route ??
- проверка «чтение-кода»: подтверждает (высокая) — Мой угол — точность цитаты и строки — находку НЕ опровергает, цитата дословная. `/Users/styserg/Parking24/src/server/automations/dispatcher.ts:28`: `  const renderedText = renderTemplate(templateBody, { booking, client });` — ровно строка 28, третьего аргумента нет. Механизм тоже подтверждается по файлам: 1) `render.ts:20` — `extras: RenderExtras = {}`, и `render.ts:32,38,51,52` читают ТОЛЬКО отту

### src/server/automations/render.ts:45 — transferLine берёт флаг «нужен трансфер» вместо правила «бесплатно от 4 суток» — клиенту обещают бесплатный трансфер на двух сутках

*✅ подтверждено* · направление: render

**Что происходит.** `transferNeeded` — это галочка «Трансфер» в быстром окне CRM (QuickBookingDrawer.tsx:275–276), то есть «клиенту нужен трансфер», а не «трансфер бесплатный». Админ заводит бронь по звонку на 2 суток, клиент спросил про трансфер, админ ставит галочку → `{{booking.transferLine}}` шлёт «Трансфер до терминала и обратно для вас бесплатный», хотя порог — 4 суток; на ресепшене конфликт и потеря денег. Обратный случай: бронь создана на 3 суток (createBooking сам выставляет флаг только при days >= 4, bookings.ts:66), потом админ правит даты на 6 суток — `updateBooking` пишет `transferNeeded: input.transferNeeded` из формы (bookings.ts:311) и не пересчитывает порог, поэтому клиенту с 6 сутками сообщение скажет, что трансфер платный. Правило «от 4 суток» при этом лежит в трёх местах: `FREE_TRANSFER_MIN_DAYS` (tariffs.ts:26), локальная `const freeTransferDays = 4` (bookings.ts:31) и строкой прямо в тексте render.ts:47 — это против правила «одно правило в одном месте» из docs/TZ_2026-09-21_PLAN.md §3.

**В коде.** `"booking.transferLine": booking.transferNeeded       ? "Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут."`

**Правка.** В render.ts считать признак от суток, а не от флага заявки: `const freeTransfer = booking.kind === "PARKING" && days >= FREE_TRANSFER_MIN_DAYS;` и использовать `freeTransfer` в `transferLine` и `returnLine`; в тексте подставлять `${FREE_TRANSFER_MIN_DAYS}` вместо «4», импортируя константу из @/lib/tariffs.

- проверка «воспроизведение»: подтверждает (высокая) — Дефект подтверждается по файлам. render.ts:45-50 ключуется на один булев флаг: `"booking.transferLine": booking.transferNeeded ? "Трансфер ... для вас бесплатный" : "Бесплатный трансфер действует при стоянке от 4 суток..."`. А заполняется этот флаг в bookings.ts:66 через ИЛИ: `transferNeeded: input.transferNeeded \|\| (input.kind === "PARKING" && days >= freeTransferDays)` — то есть «клиент просил
- проверка «чтение-кода»: подтверждает (высокая) — Цитата совпадает с файлом посимвольно и строка указана верно. `/Users/styserg/Parking24/src/server/automations/render.ts:44-50`:  ```     // Бесплатный трансфер — от 4 суток (признак ставится при создании брони)     "booking.transferLine": booking.transferNeeded       ? "Трансфер до терминала и обратно для вас бесплатный, дорога занимает 3–5 минут."       : "Бесплатный трансфер действует при стоян

## Важно (25)


### src/app/admin/(app)/bookings/[id]/page.tsx:47 — Карточка брони не считает REJECTED терминальным: полоса этапов показывает отклонённую заявку как несозданную

*⏳ проверка не закончилась* · направление: statuses

**Что происходит.** Открываем отклонённую бронь по ссылке из колокольчика. terminal = false (проверяются только CANCELLED и NO_SHOW), order.indexOf("REJECTED") = -1 → idx = -1, поэтому st(i) для всех четырёх этапов даёт "todo": «Создана», «Оплачена», «Заехал», «Выехал» рисуются серыми часами как ещё не пройденные — хотя заявка создана и дата создания рядом же выведена. Финальный этап не добавляется (стр. 57 под if (terminal)), так что на полосе вообще нет отметки, что бронь отклонена и когда — rejectedAt на карточке не показывается нигде.

**В коде.** `const terminal = b.status === "CANCELLED" \|\| b.status === "NO_SHOW"; const order = ["NEW", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]; const idx = b.status === "AWAITING_PAYMENT" ? 0 : order.indexOf(b.status);`

**Правка.** terminal = ["CANCELLED", "NO_SHOW", "REJECTED"].includes(b.status), и в push на строке 57 добавить ветку для REJECTED: label «Отклонена», at: T(b.rejectedAt) (плюс показать rejectReason/rejectKind).


### src/app/admin/(app)/clients/[id]/page.tsx:163 — В карточке клиента отклонённая бронь показывается как долг

*⏳ проверка не закончилась* · направление: statuses

**Что происходит.** У клиента есть автоотклонённая заявка: amount посчитан по тарифу, paidAmount = 0 → due = amount > 0. В списке броней проверка исключает только CANCELLED и NO_SHOW, поэтому строка REJECTED рисуется жёлтым «долг 3 500 ₽». При этом KPI «К оплате» на той же странице (стр. 49) считает только NEW/AWAITING_PAYMENT/CONFIRMED/CHECKED_IN и REJECTED не учитывает — на одном экране два противоречащих числа, и администратор, обзванивающий должников, звонит клиенту, которому в месте отказали. Счётчик «отмен / no-show» (стр. 50) отклонённые тоже не учитывает, хотя в общее «Броней» они входят.

**В коде.** `<span className={`text-right font-mono text-[11px] tnum ${due > 0 && !["CANCELLED", "NO_SHOW"].includes(b.status) ? "text-warning" : "text-success"}`}>   {["CANCELLED", "NO_SHOW"].includes(b.status) ? "" : due > 0 ? `долг ${rub(due)}` : "оплачено"}`

**Правка.** Завести в labels.ts общий список неоплачиваемых статусов (TERMINAL уже содержит CANCELLED, NO_SHOW, REJECTED) и использовать его здесь и в строке 50 вместо литералов — «одно правило в одном месте».


### src/app/admin/(app)/settings/capacity/page.tsx:23 — «Сейчас занято мест» на странице ёмкости считает фуры вместе с общим пулом

*⏳ проверка не закончилась* · направление: settings

**Что происходит.** `parkingDashboard.held` (occupancy.ts:103) — это count броней PARKING без фильтра по vehicleType, то есть пул + грузовые. На странице это число подписано просто «Сейчас занято мест» и стоит рядом с полем «Всего мест — легковые, кроссоверы и мотоциклы вместе» (405) и порогом (395), который `fits()` сравнивает только с пулом (autoconfirm.ts:56, poolWhere → POOL_TYPES). 380 легковых + 8 фур: владелец видит «занято 388» при пороге 395 и решает, что до остановки автоподтверждения осталось 7 мест, тогда как в пуле занято 380 и свободно 15. Единственная цифра, по которой владелец сверяет вместимость, показывает не тот пул.

**В коде.** `<CapacityForm settings={settings} occupiedNow={dash.held} /> // occupancy.ts:103 — prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } })`

**Правка.** Передавать занятость пула — `poolLoad("POOL", today, today)` (уже есть в occupancy.ts:85) — либо добавить в parkingDashboard отдельное поле heldPool и показывать пул и фуры двумя числами.


### src/app/admin/actions/bookings.ts:147 — Проверка мест в CRM осталась по категориям и по старой ёмкости 60/30/10/5, пул её не заменил

*✅ подтверждено* · направление: occupancy

**Что происходит.** Админ заводит бронь на кроссовер на даты, где уже 30 кроссоверов: quoteAction → occupancySummary считает ёмкость из CapacityConfig (seed.ts:32–35: 60/30/10/5), и QuickBookingDrawer.tsx:227 рисует «свободно 0 из 30 — перегруз!», хотя в общем пуле занято 31 из 405. Тем же источником живут полосы TodayStrip и построчные ряды сетки. Хуже того, saveCapacityAction (settings.ts:33) при сохранении новых 405/395 выставляет capacityIsPlaceholder = false, и предупреждение «Ёмкость по типам ТС — плейсхолдер» с /admin/occupancy (page.tsx:21) исчезает — фальшивые числа остаются, а метка о том, что они фальшивые, снимается. Нарушено правило «одно правило в одном месте» и ТЗ п. 6 (перевод quoteAction/QuickBookingDrawer на общий пул).

**В коде.** `occupancySummary(kind, dateFrom, dateTo, { vehicleType, roomType, excludeBookingId }),`

**Правка.** В quoteAction для PARKING брать poolLoad(vehicleType === "TRUCK" ? "TRUCK" : "POOL", dateFrom, dateTo, excludeBookingId) и отдавать его capacity/minFree; пока не переведено — не сбрасывать capacityIsPlaceholder в saveCapacityAction.

- проверка «воспроизведение»: подтверждает (высокая) — Прошёл сценарий по шагам, ни на одном шаге нет проверки, которая бы погасила дефект. QuickBookingDrawer.tsx:43 `useState<VehicleType>("CAR")` → :112 `quoteAction("PARKING", dateFrom, dateTo, vehicleType, ...)` (тип ТС передаётся всегда, фильтр не отваливается) → bookings.ts:147 `occupancySummary(kind, dateFrom, dateTo, { vehicleType, roomType, excludeBookingId })` → occupancy.ts:46 → :12 `capacity
- проверка «чтение-кода»: подтверждает (высокая) — Цитата совпадает с файлом посимвольно: src/app/admin/actions/bookings.ts:147 — `occupancySummary(kind, dateFrom, dateTo, { vehicleType, roomType, excludeBookingId }),` внутри quoteAction (строки 139–153). Цепочка проверена по файлам: occupancySummary → occupancy → capacityFor (occupancy.ts:12–17) берёт ёмкость из `prisma.capacityConfig.findMany({ where: { kind, ...(kind === "PARKING" ? { vehicleTy

### src/app/admin/actions/settings.ts:47 — markNoticesReadAction без проверки роли — охрана может погасить уведомления владельца

*⏳ проверка не закончилась* · направление: settings

**Что происходит.** Пользователь с ролью GUARD логинится (seed создаёт такого через SEED_GUARD_PASSWORD), layout `src/app/admin/(app)/layout.tsx:11` его на страницы не пускает (`requireUser(["OWNER","ADMIN"])`), но серверное действие выполняется ДО рендера страницы, поэтому layout его не защищает. POST этого действия напрямую → `markNoticesRead` помечает прочитанными все уведомления об автоотклонённых заявках. Все остальные действия в репозитории роли передают явно: `requireActor(STAFF)` в clients.ts:27,66,79…, `requireActor(STAFF|ALL)` в bookings.ts:29,47…, `requireActor(OWNER)` строкой 18 этого же файла — пропуск только здесь.

**В коде.** `const actor = await requireActor();   // markNoticesReadAction, без списка ролей`

**Правка.** `await requireActor(STAFF)` — колокольчик рендерится только в AdminShell, а он доступен OWNER/ADMIN.


### src/app/admin/actions/settings.ts:22 — Вместимость сохраняется без сверки с текущей занятостью — опечатка молча закрывает приём заявок

*⏳ проверка не закончилась* · направление: settings

**Что происходит.** Проверки есть только на «больше нуля» и «порог ≤ вместимости». Владелец при 380 занятых местах опечатывается и вводит 45 вместо 405 → сохраняется без предупреждения, `parkingSettings` зажимает порог до `Math.min(45, 395) = 45` (settings.ts:39), и при включённом автоподтверждении каждая заявка с сайта уходит в REJECTED (autoconfirm.ts:56-59), а сайт отвечает клиенту state «rejected» (api/public/lead/route.ts:54). Обратной связи никакой: форма пишет «Сохранено», а поле «Сейчас занято мест» рядом показывает 388 (см. отдельную находку) и на решение не влияет.

**В коде.** `if (!Number.isFinite(total) \|\| total < 1) return { ok: false, error: "Вместимость должна быть больше нуля" };`

**Правка.** Посчитать пик занятости пула на ближайший горизонт (`poolLoad("POOL", …).peak`) и при `total < peak` возвращать ошибку с числом («сейчас занято N мест») либо требовать явного подтверждения.


### src/components/BookingCalculator.tsx:196 — При повторной отправке заголовок карточки противоречит шагам: «Заявка уже у администратора» при уже подтверждённой броне

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** Автоподтверждение включено, места есть. 10:00 клиент отправляет заявку → бронь №100 в AWAITING_PAYMENT, сайт показывает «Место забронировано · №100». 10:03 клиент перезагружает страницу и жмёт «Забронировать» ещё раз с теми же датами, тем же авто и телефоном. createSiteLead (leads.ts:45–63) попадает в дедуп-окно 10 минут и возвращает ту же бронь с duplicate: true; route.ts:54 считает state из booking.status → "confirmed". В калькуляторе тернарник проверяет duplicate РАНЬШЕ confirmed, поэтому в заголовке «Заявка уже у администратора», а прямо под ним список шагов (строки 177–181, ветка confirmed) говорит «Место забронировано», «Оплата при заезде, предоплата не нужна». Одна карточка одновременно сообщает клиенту, что бронь ещё ждёт администратора и что она уже подтверждена.

**В коде.** `{rejected ? "Мест на эти даты нет" : lead.duplicate ? "Заявка уже у администратора" : confirmed ? "Место забронировано" : "Заявка принята"}`

**Правка.** Решать заголовок по state, а duplicate использовать только как уточнение: сначала rejected → «Мест на эти даты нет», затем confirmed → «Место забронировано» (при duplicate можно добавить «(заявка уже была)»), и только в ветке pending — «Заявка уже у администратора».


### src/components/admin/AdminShell.tsx:9 — Уведомления читаются в layout, а layout в Next 16.3 не перерисовывается при переходах — бейдж застывает на всю сессию

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** unreadNotices() вызывается в AdminShell, который рендерится из src/app/admin/(app)/layout.tsx. node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md, раздел Caveats: «Layouts are cached in the client during navigation to avoid unnecessary server requests. Layouts do not rerender.» Сценарий: админ открыл /admin/boards/PARKING в 09:00 (бейдж 0) и работает всё утро, переходя по ссылкам сайдбара; в 10:30 сайт автоотклоняет заявку и создаёт AdminNotice. Колокольчик продолжает показывать 0 — переходы между страницами админки забирают с сервера только сегмент page, layout берётся из клиентского кэша. Обновится только при жёсткой перезагрузке, router.refresh() или после какого-нибудь server action. Именно для этого уведомления и делались: узнать, что заявку потеряли, надо в течение минут, а не «когда-нибудь перезагрузишь вкладку». Плюс побочный эффект: запрос лежит в layout без Suspense, то есть задерживает первый байт каждой полной загрузки любой страницы админки.

**В коде.** `export default async function AdminShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {   const rows = await unreadNotices();`

**Правка.** Вынести получение уведомлений из layout в сам NoticeBell: оставить в AdminShell только начальное значение, а в клиентском компоненте опрашивать лёгкий server action/route (unreadNotices уже есть, unreadCount тоже) раз в 30–60 с и обновлять бейдж. Как минимум обернуть загрузку в <Suspense>, чтобы она не задерживала выдачу страницы.


### src/components/admin/NoticeBell.tsx:18 — Кнопка «Прочитано» гасит все непрочитанные уведомления, включая пришедшие после отрисовки панели

*✅ подтверждено* · направление: concurrency

**Что происходит.** Админ открыл колокольчик с двумя отказами. Пока панель открыта, с сайта приходит третья автоотклонённая заявка — adminNotice создаётся, но панель отрисована на сервере и её не показывает. Админ жмёт «Прочитано» → markNoticesRead вызывается без ids и делает updateMany по where { readAt: null } без фильтра по id, помечая прочитанной в том числе третью. Она уже никогда не всплывёт, и резерв этому клиенту никто не предложит — остаётся только заметить бронь в колонке «Отклонена» вручную.

**В коде.** `await markNoticesReadAction();   // notices.ts:25 — where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }`

**Правка.** Передавать показанные идентификаторы: markNoticesReadAction(notices.map((n) => n.id)) — и экшен, и сервис уже умеют принимать список.

- проверка «воспроизведение»: подтверждает (высокая) — Пошёл по цепочке вызовов и не нашёл ни одной проверки, которая бы не дала дефекту проявиться.  1. Создание уведомления: `src/server/services/leads.ts:100-102` — `if (decision.status === "REJECTED") { await notify("BOOKING_REJECTED", ...) }`, а `notify` (`src/server/services/notices.ts:6-8`) делает `tx.adminNotice.create({ data: { kind, text, bookingId } })` — поле `readAt` остаётся null. Путь реал
- проверка «чтение-кода»: подтверждает (высокая) — Цитаты совпадают с файлами дословно и по номерам строк. NoticeBell.tsx:18 — ровно `await markNoticesReadAction();` без аргументов; notices.ts:25 — ровно `where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },`. Предложенная правка реализуема без новой обвязки: settings.ts:45 `export async function markNoticesReadAction(ids?: string[])` → settings.ts:48 `await markNoticesRead(actor.i

### src/components/admin/NoticeBell.tsx:18 — «Прочитано» гасит все непрочитанные уведомления, а не только показанные — часть админ не увидит никогда

*✅ подтверждено* · направление: settings

**Что происходит.** `unreadNotices(take = 20)` (notices.ts:10) отдаёт только 20 последних, бейдж при этом показывает «9+». 25 непрочитанных автоотклонений → админ видит 20, жмёт «Прочитано» → `markNoticesRead(userId, undefined)` (notices.ts:23-26) делает updateMany БЕЗ `id in (...)` и ставит readAt всем 25. Пять уведомлений о заявках, которым отказали из-за отсутствия мест (то есть о потерянных клиентах), исчезают безвозвратно: `unreadNotices` фильтрует по `readAt: null`, а другого списка уведомлений в интерфейсе нет. Тот же эффект в гонке: уведомление, созданное между рендером шапки и кликом, гасится непоказанным.

**В коде.** `await markNoticesReadAction();   // ids не передаются // notices.ts:25 → where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }`

**Правка.** `await markNoticesReadAction(notices.map((n) => n.id));` — список уже есть в пропсах компонента.

- проверка «воспроизведение»: подтверждает (высокая) — Пошёл по цепочке вызовов и не нашёл ни одной проверки, которая бы не дала дефекту проявиться.  1. Создание уведомления: `src/server/services/leads.ts:100-102` — `if (decision.status === "REJECTED") { await notify("BOOKING_REJECTED", ...) }`, а `notify` (`src/server/services/notices.ts:6-8`) делает `tx.adminNotice.create({ data: { kind, text, bookingId } })` — поле `readAt` остаётся null. Путь реал
- проверка «чтение-кода»: подтверждает (высокая) — Цитаты совпадают с файлами дословно и по номерам строк. NoticeBell.tsx:18 — ровно `await markNoticesReadAction();` без аргументов; notices.ts:25 — ровно `where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },`. Предложенная правка реализуема без новой обвязки: settings.ts:45 `export async function markNoticesReadAction(ids?: string[])` → settings.ts:48 `await markNoticesRead(actor.i

### src/components/admin/NoticeBell.tsx:18 — «Прочитано» гасит все непрочитанные уведомления, включая те, которых админ не видел

*✅ подтверждено* · направление: ui

**Что происходит.** markNoticesReadAction вызывается без ids, а markNoticesRead (notices.ts:23–27) делает updateMany по where { readAt: null } без ограничения по id. Сценарий: админ открыл страницу в 10:00, в колокольчике 2 уведомления (они и попали в пропс из layout); в 10:07 и 10:08 сайт автоотклоняет ещё две заявки — новых уведомлений в открытом списке не видно (layout не перерисовывается); в 10:10 админ жмёт «Прочитано» → readAt проставляется всем четырём. Две потерянные заявки исчезают из колокольчика навсегда, а больше нигде автоотклонение не всплывает — только если руками открыть доску и заметить колонку «Отклонена». Второй вариант того же: unreadNotices берёт take = 20, при 50 непрочитанных бейдж показывает «9+», в списке 20, а кнопка гасит все 50.

**В коде.** `await markNoticesReadAction();`

**Правка.** Передавать в действие именно те id, что отрисованы: markNoticesReadAction(notices.map((n) => n.id)). Действие ids уже поддерживает (settings.ts:45, notices.ts:23).

- проверка «воспроизведение»: подтверждает (высокая) — Пошёл по цепочке вызовов и не нашёл ни одной проверки, которая бы не дала дефекту проявиться.  1. Создание уведомления: `src/server/services/leads.ts:100-102` — `if (decision.status === "REJECTED") { await notify("BOOKING_REJECTED", ...) }`, а `notify` (`src/server/services/notices.ts:6-8`) делает `tx.adminNotice.create({ data: { kind, text, bookingId } })` — поле `readAt` остаётся null. Путь реал
- проверка «чтение-кода»: подтверждает (высокая) — Цитаты совпадают с файлами дословно и по номерам строк. NoticeBell.tsx:18 — ровно `await markNoticesReadAction();` без аргументов; notices.ts:25 — ровно `where: { readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },`. Предложенная правка реализуема без новой обвязки: settings.ts:45 `export async function markNoticesReadAction(ids?: string[])` → settings.ts:48 `await markNoticesRead(actor.i

### src/components/admin/occupancy/ParkingSummary.tsx:25 — Порог автоподтверждения сверяется не с той величиной: held включает фуры и считается только на сегодня

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** Настройки по умолчанию: capacityTotal 405 (пул), capacityTruck 10, autoConfirmLimit 395. Сегодня на стоянке 390 легковых/кроссоверов/мото и 8 фур. parkingDashboard (occupancy.ts:103) считает heldNow одним count'ом по kind="PARKING" без фильтра vehicleType → held = 398, capacity = 405+10 = 415. nearLimit = 398 >= 395 → истина, и на /admin/occupancy горит жёлтая плашка «Занято 398 мест из 415 — новые заявки с сайта отклоняются автоматически». На самом деле решение принимает decideSiteBooking → fits(spans, …, 395), где spans берутся только по POOL_TYPES: пик пула 390, 390+1 ≤ 395 → заявки продолжают подтверждаться. Админ видит ложную тревогу и может вручную отказывать клиентам. Обратный случай тоже есть: пул на 15.10 забит на 400, а сегодня занято 200 → плашка молчит, хотя заявки с сайта на октябрь уже отклоняются (fits считает пик по датам заявки, а не по сегодня). Тот же корень у плитки «Свободно сейчас» (строка 22): freeNow = 415 − held, при полном пуле 405 и нуле фур покажет 10 свободных мест, куда легковую поставить нельзя.

**В коде.** `const nearLimit = p.held >= p.autoConfirmLimit;`

**Правка.** Считать занятость пула отдельно от фур и сравнивать с порогом ту же величину, которую использует автоподтверждение. В parkingDashboard добавить heldPool (count с vehicleType: { in: [...POOL_TYPES] }) и heldTruck, передавать heldPool в ParkingSummary для nearLimit и для текста плашки, а freeNow разложить на «свободно в пуле» и «свободно для фур». Правило порога держать в одном месте — переиспользовать peakLoad/fits из src/lib/occupancy-math.ts, а не писать сравнение заново в компоненте.


### src/lib/crm/labels.ts:68 — Два почти одинаковых глагола перехода: «Подтвердить место» (→ Ожидает оплаты) и «Подтвердить» (→ Оплачена)

*✅ подтверждено* · направление: statuses

**Что происходит.** На новой заявке TransitionButtons рисует по TRANSITIONS.NEW четыре кнопки подряд: «Подтвердить место» (→ AWAITING_PAYMENT, нейтральный стиль), «Подтвердить» (→ CONFIRMED, стиль adm-btn-primary, т.к. CONFIRMED входит в PRIMARY), «Отклонить», «Отменить». Предоплаты нет, поэтому администратор, подтверждающий место, с высокой вероятностью жмёт выделенную главную кнопку «Подтвердить». Последствия: статус CONFIRMED при paidAmount = 0, в списке и на канбане он показывается коротким ярлыком «Оплачена» (STATUS_SHORT.CONFIRMED), проставляется confirmedAt, и срабатывает правило on_confirmed — клиенту уходит шаблон booking_confirmed «Бронь №… подтверждена», вместо awaiting_payment «место подтверждено… оплатить можно на месте при заезде». Клиент получает не то сообщение, а смена на CONFIRMED сама по себе необратима кнопками (только через «Исправление статуса»).

**В коде.** `export const TRANSITION_VERB: Partial<Record<BookingStatus, string>> = {   AWAITING_PAYMENT: "Подтвердить место",   REJECTED: "Отклонить",   CONFIRMED: "Подтвердить",`

**Правка.** Развести подписи по фактическому смыслу: AWAITING_PAYMENT — «Подтвердить место» оставить и сделать её главной кнопкой (добавить AWAITING_PAYMENT в PRIMARY в TransitionButtons.tsx:10), а CONFIRMED переименовать в «Отметить оплату» / «Оплачено», раз CONFIRMED теперь означает именно оплату.

- проверка «чтение-кода»: подтверждает (высокая) — Пытался опровергнуть — не вышло, цитата и строка совпадают с файлом дословно.  1) `src/lib/crm/labels.ts`, строки 67–75 (строка 68 — ровно та, что указана): ``` 67 export const TRANSITION_VERB: Partial<Record<BookingStatus, string>> = { 68   AWAITING_PAYMENT: "Подтвердить место", 69   REJECTED: "Отклонить", 70   CONFIRMED: "Подтвердить", ``` 2) `labels.ts:56` — `NEW: ["AWAITING_PAYMENT", "CONFIRME

### src/server/automations/render.ts:41 — Сумма выводится двумя разными способами: «1050 ₽» в одном сообщении и «1 050 ₽» в другом

*⏳ проверка не закончилась* · направление: render

**Что происходит.** Бронь на 3 суток за 1050 ₽. Сообщение 1 («Место забронировано», строка «Стоимость: {{booking.amount}} ₽ за {{booking.days}}») рендерится как «Стоимость: 1050 ₽ за 3 суток» — проверено прогоном. Сообщение 2 («Напоминание», `{{booking.dueLine}}`) рендерится как «К оплате на месте: 1 050 ₽, наличными или картой.» — с неразрывным пробелом (U+00A0, проверил коды символов). Сайт в калькуляторе показывает «1 050 ₽» (formatRub, BookingCalculator.tsx:213). Итого один и тот же клиент по одной и той же броне видит три вида одной суммы; на длинных стоянках разрыв заметнее: 30 суток × 250 = «7500 ₽» против «7 500 ₽». То же касается `{{booking.due}}` (render.ts:42) и шаблона «Бронь изменена», где тоже стоит `{{booking.amount}} ₽`.

**В коде.** `"booking.amount": String(booking.amount),`

**Правка.** `"booking.amount": booking.amount.toLocaleString("ru-RU")` и `"booking.due": due.toLocaleString("ru-RU")` — знак ₽ остаётся в шаблоне, форматирование совпадёт с dueLine и с сайтом; тест render.test.ts:28 поправить на «1 050 ₽» через тот же nb()-помощник, что в строке 68.


### src/server/lib/dates.ts:64 — plannedMoment зависит от таймзоны процесса: в «дыре» перехода на летнее время локальной TZ ошибается на час

*⏳ проверка не закончилась* · направление: render

**Что происходит.** Смещение Москвы считается разбором отформатированной строки обратно через `new Date(...)`, а эта строка парсится в ЛОКАЛЬНОЙ зоне процесса. Проверил запуском с разными TZ: при TZ=America/New_York `plannedMoment("2026-03-08", "02:30")` возвращает 2026-03-08T00:30:00.000Z вместо правильного 2026-03-07T23:30:00.000Z — ровно час мимо, потому что 02:30 8 марта в Нью-Йорке не существует и движок сдвигает разбор вперёд. При TZ=UTC, Europe/Moscow, Europe/Berlin и Asia/Jakarta (машина разработчика) всё верно, поэтому tests/unit/planned-moment.test.ts зелёный и ошибка не видна; контейнер сейчас тоже UTC (TZ в docker-compose.yml и Dockerfile не задан), но функция написана как независимая от окружения и комментарий обещает именно это. Последствие, когда напоминание подключат: оно уйдёт на час раньше или позже планового заезда.

**В коде.** `const shown = new Date(guess.toLocaleString("en-US", { timeZone: tz }));`

**Правка.** Не парсить локаль-строку, а взять смещение напрямую: `const off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(guess).find(p => p.type === "timeZoneName")!.value` → разобрать «GMT+03:00» и вычесть из `guess`; в тест добавить прогон с `process.env.TZ = "America/New_York"`.


### src/server/services/autoconfirm.ts:48 — Настройки читаются вторым соединением изнутри уже открытой транзакции — пул исчерпывается, заявка теряется целиком

*✅ подтверждено* · направление: concurrency

**Что происходит.** Пул Prisma по умолчанию = число ядер × 2 + 1 (на 2-ядерном VPS — 5), в DATABASE_URL (docker-compose.yml:27) connection_limit не задан. Пять заявок с сайта приходят одновременно: каждая открывает prisma.$transaction в createBooking (bookings.ts:33 — соединение занято) и уже внутри неё вызывает parkingSettings(), который идёт через глобальный prisma (settings.ts:32) и просит ВТОРОЕ соединение из того же пула. Свободных нет → все пять ждут pool_timeout (10 с) → P2024, транзакции откатываются, клиенты получают 500 «Ошибка сервера», ни одной брони не создано. Строка 48 выполняется ДО проверки s.autoConfirm, то есть и на stage с выключенным автоподтверждением каждая заявка с сайта теперь проходит через эту точку отказа, которой до 99abd0e на этом пути не было (раньше лид создавался без чтения настроек). Ситуацию усугубляет advisory-лок: ожидающие его транзакции продолжают держать своё соединение, а дефолтный таймаут интерактивной транзакции 5 с превращает очередь в серию P2028.

**В коде.** `const s = await parkingSettings();   // autoconfirm.ts:48, вызвано из decide внутри prisma.$transaction; внутри — prisma.setting.findMany на глобальном клиенте`

**Правка.** Дать parkingSettings параметр клиента — parkingSettings(db: Prisma.TransactionClient = prisma) — как уже сделано в notify() (notices.ts:6) и upsertClientByPhone() (clients.ts:11), и передавать tx из decideSiteBooking. Заодно задать явный timeout в prisma.$transaction, раз внутри появилось ожидание лока.

- проверка «воспроизведение»: подтверждает (высокая) — Я пытался опровергнуть находку по шагам и не смог — цепочка вызовов подтверждается целиком по файлам.  Последовательность от входа до дефекта: 1. `src/app/api/public/lead/route.ts:27` POST → `rateLimited(ipHash)` (лимит 8 за 10 мин **на IP**, значит пять разных клиентов проходят одновременно) → `createSiteLead(...)` (строка 53). 2. `src/server/services/leads.ts:74` `createBooking(..., null, async 
- проверка «чтение-кода»: подтверждает (высокая) — Пытался опровергнуть по каждому пункту — не вышло, цитата и строка совпадают дословно.  1. Цитата и строка. `/Users/styserg/Parking24/src/server/services/autoconfirm.ts:48` — ровно `  const s = await parkingSettings();`, и это первая исполняемая строка `decideSiteBooking` (сигнатура на 44–47). Порядок тоже как заявлено: 48 — чтение настроек, 49 — `if (!s.autoConfirm) return { status: "NEW", reason

### src/server/services/autoconfirm.ts:52 — В условиях автоподтверждения нет проверки «цена больше нуля», которую требует план

*⏳ проверка не закончилась* · направление: statuses

**Что происходит.** План, Этап 1: «Автоподтверждение в createSiteLead: парковка, не фура, цена больше нуля, телефон распознан, выключатель включён». В decideSiteBooking проверяются выключатель, TRUCK, наличие vehicleType и телефона — суммы нет, она считается в createBooking отдельно и решателю не передаётся. quote() возвращает amount 0, если активного тарифа под тип ТС не нашлось (`if (!t) return { amount: 0, perDay: 0 }`). Сценарий: владелец снимает isActive с тарифа moto (или заводит новый тип ТС без тарифа) — заявка на мотоцикл проходит автоподтверждение, создаётся в «Ожидает оплаты» с amount = 0, и правило on_awaiting_payment шлёт клиенту «место подтверждено! Бронь №N … стоимость 0 ₽. Оплатить можно на месте». Клиент получает подтверждение бесплатной стоянки.

**В коде.** `if (!s.autoConfirm) return { status: "NEW", reason: "off" }; if (input.vehicleType === "TRUCK") return { status: "NEW", reason: "truck" }; if (!input.vehicleType) return { status: "NEW", reason: "manual" }; if (!input.phone) return { status: "NEW", reason: "no_phone" };`

**Правка.** Передавать посчитанный amount в decideSiteBooking (в createBooking он уже вычислен до транзакции) и добавить `if (!(amount > 0)) return { status: "NEW", reason: "manual" };` перед блокировкой занятости.


### src/server/services/leads.ts:45 — Проверка на дубль идёт до транзакции и вне лока: повторная заявка занимает второе место и шлёт второе подтверждение

*✅ подтверждено* · направление: concurrency

**Что происходит.** Две POST /api/public/lead с одним телефоном и датами приходят с разницей меньше длительности транзакции (две вкладки, повтор после таймаута прокси, ретрай клиента — защита в BookingCalculator.tsx:140 держит только одну вкладку). Обе выполняют findFirst раньше, чем первая бронь закоммичена → обе видят «дубля нет» → создаются две брони. При включённом автоподтверждении advisory-лок лишь выстраивает их в очередь: вторая пересчитывает занятость, видит свободное место и тоже получает AWAITING_PAYMENT — один клиент держит два места из 405 и получает два подтверждения (dedupKey в enqueue — `${ruleCode}:${booking.id}`, у разных броней ключи разные, dispatcher.ts:24). При выключенном автоподтверждении (текущее состояние stage) лок не берётся вовсе — autoconfirm.ts:49 выходит до lockOccupancy — обе транзакции идут параллельно и обе делают client.create с одним телефоном (Client.phone уникален, clients.ts:18-25), проигравшая падает с P2002, откатывается целиком и отдаёт клиенту «Ошибка сервера», хотя соседний запрос заявку создал.

**В коде.** `const dup = await prisma.booking.findFirst({ where: { source: "SITE", createdAt: { gte: new Date(Date.now() - DEDUP_MS) }, ... } });  // строка 45, затем createBooking на строке 74`

**Правка.** Брать OCCUPANCY_LOCK для любой заявки с сайта (до выхода по !s.autoConfirm) и перенести поиск дубля внутрь транзакции после лока; либо добавить уникальный индекс на (source, contactPhone, dateFrom, dateTo) и обрабатывать конфликт как дубль.

- проверка «воспроизведение»: подтверждает (высокая) — Прошёл путь от входа до дефекта, пытаясь найти шаг-предохранитель. Не нашёл ни одного.  1) `src/app/api/public/lead/route.ts:31` — `rateLimited(ipHash)` с `LIMIT = 8` за 10 мин: два запроса проходят. Ханипот-проверка `if (d.ts && Date.now() - d.ts < 1500)` срабатывает только на сабмит быстрее 1.5 с после монтирования формы — две открытые вкладки её проходят.  2) `src/server/services/leads.ts:45` —
- проверка «чтение-кода»: подтверждает (высокая) — Пытался опровергнуть по каждой цитате — все шесть совпали с файлами дословно, ни одна не «по памяти».  1. `/Users/styserg/Parking24/src/server/services/leads.ts:45` — ровно `const dup = await prisma.booking.findFirst({` с `where: { source: "SITE", createdAt: { gte: new Date(Date.now() - DEDUP_MS) }, ... }`, и `const booking = await createBooking(` действительно на строке 74. Между ними нет ни тран

### src/server/services/leads.ts:100 — Уведомление администратору об автоотклонении создаётся после коммита, вне транзакции

*✅ подтверждено* · направление: concurrency

**Что происходит.** Бронь уже закоммичена со статусом REJECTED, а adminNotice пишется отдельным запросом после транзакции на глобальном prisma. Если этот запрос не проходит (обрыв соединения, pool_timeout из находки 1, рестарт контейнера при деплое между коммитом и вставкой) — колокольчик остаётся пустым, а клиенту вместо «Мест на эти даты нет» уходит 500 «Ошибка сервера»: route.ts:56 ловит исключение уже после того, как бронь создана. По ТЗ отказ обязан дойти до администратора — именно по этому сигналу предлагается резерв из 10 мест, так что молчаливая потеря уведомления = потерянный клиент.

**В коде.** `if (decision.status === "REJECTED") {\n    await notify("BOOKING_REJECTED", `Заявка №${booking.number} отклонена...`, booking.id);\n  }   // вне prisma.$transaction, хотя notify() принимает tx (notices.ts:6)`

**Правка.** Добавить в createBooking необязательный хук afterCreate(tx, booking) и создавать уведомление им, в той же транзакции: notify("BOOKING_REJECTED", ..., booking.id, tx).

- проверка «воспроизведение»: подтверждает (средняя) — Попытка опровергнуть не удалась: ни на одном шаге нет проверки, которая бы не дала дефекту проявиться.  Цепочка вызовов, проверенная по файлам: 1. `src/app/api/public/lead/route.ts:51-59` — `try { const { booking, duplicate } = await createSiteLead(...) } catch (e) { ... return NextResponse.json({ ok: false, error: "Ошибка сервера" }, { status: 500 }) }`. Строка 56 действительно `} catch (e) {` — 
- проверка «чтение-кода»: подтверждает (высокая) — Проверил по файлам, цитата совпадает с кодом дословно и строка указана верно. `/Users/styserg/Parking24/src/server/services/leads.ts` строки 99–102:  ```  99:  ); 100:  if (decision.status === "REJECTED") { 101:    await notify("BOOKING_REJECTED", `Заявка №${booking.number} отклонена: на выбранные даты нет мест (${lead.dateFrom} → ${lead.dateTo})`, booking.id); 102:  } ```  Блок действительно стои

### src/server/services/occupancy.ts:103 — Перестои («Заехал» с прошедшей датой выезда) не считаются занятыми: «Свободно сейчас» спорит с «Авто на парковке», а автоподтверждение раздаёт занятые места

*✅ подтверждено* · направление: concurrency

**Что происходит.** Автоматического закрытия броней в коде нет — CHECKED_OUT ставится только ручным transition, никакого крона или планировщика по статусам в src/ нет. Клиент с бронью до вчера ещё стоит: статус CHECKED_IN, dateTo в прошлом. onSite (строка 97, фильтр только по статусу) его считает, heldNow (строка 103) — нет, потому что требует dateTo >= сегодня. На одной панели выходит «Авто на парковке 300» и одновременно «Свободно сейчас 415 − 280 = 135». Тот же фильтр в autoconfirm.poolPeak (autoconfirm.ts:32-33): машины, стоящие сверх срока, не попадают в пик, и автоподтверждение выдаёт места, физически занятые. Буфер в 10 мест (порог 395 из 405) съедается десятком перестоев — при задержках рейсов это рядовая величина.

**В коде.** `prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } })`

**Правка.** Считать место занятым по правилу «пересекает дату ИЛИ статус CHECKED_IN без checkedOutAt» и держать это правило в одном месте (occupancy-math + одна выборка), чтобы им пользовались и панель, и autoconfirm.poolPeak.

- проверка «воспроизведение»: подтверждает (высокая) — Пытался опровергнуть — не смог, механика подтверждается по файлам.  1) Состояние «перестой» (CHECKED_IN при dateTo в прошлом) достижимо и штатно. Автозакрытия нет: `CHECKED_OUT` проставляется только в `transition()` (src/server/services/bookings.ts:111,172: `if (to === "CHECKED_OUT") { data.checkedOutAt = at; ... }`) и в `correctStatus()`; в src/server/automations/ лежат только dispatcher.ts и ren
- проверка «чтение-кода»: подтверждает (высокая) — Цитата совпадает с файлом посимвольно. occupancy.ts:103 — `prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } })`, и это ровно вычисление heldNow, из которого на строке 111 считается `freeNow: Math.max(0, capacity - heldNow)`. Строка 97 — `prisma.booking.count({ where: { kind: "PARKING", status: "CHECKED_IN" } })`, фильтра по да

### src/server/services/occupancy.ts:70 — Машина, которая стоит дольше брони (CHECKED_IN с dateTo в прошлом), выпадает из занятости — и из пика для автоподтверждения

*✅ подтверждено* · направление: occupancy

**Что происходит.** Бронь 10–15.09, статус «Заехал», рейс задержали, 16.09 машина ещё на стоянке. 16.09 poolSpans требует dateTo >= 16.09 — эта бронь в выборку не попадает; heldNow (строка 103) её тоже не считает, а onSite (строка 97, без фильтра по датам) считает. На одной панели получается «Авто на парковке 400» и «Свободно сейчас 15». Автоподтверждение (autoconfirm.ts:33, тот же фильтр) видит пик на число задержавшихся меньше реального: при 6 задержавшихся пик 394 вместо 400 → заявка подтверждается и клиент получает «Место забронировано». При числе задержавшихся больше резерва в 10 мест это уже прямой перебор мест. Что система такие случаи ждёт, видно по /admin/today (строка 23 today/page.tsx): там выезды берутся как CHECKED_IN с dateTo <= сегодня, то есть просроченные показываются.

**В коде.** `dateTo: { gte: toDate(from) },   // poolSpans; тот же фильтр в autoconfirm.ts:33 и в heldNow (строка 103)`

**Правка.** Для заехавших броней считать отрезок открытым: в poolSpans/poolPeak/heldNow добавить ветку OR { status: "CHECKED_IN", dateTo: { lt: toDate(from) } } и при сборке Span подставлять dateTo = max(dateTo, сегодня).

- проверка «воспроизведение»: подтверждает (высокая) — Прошёл сценарий по коду от входа до дефекта, ни одна проверка его не перехватывает.  1) Просроченные CHECKED_IN реально существуют и не закрываются сами. Автозакрытия нет: единственная автоматика на статусах — `onStatusChanged` в `src/server/automations/dispatcher.ts` (только отправка сообщений, статусы не меняет), переходы делает только человек через `transition()`. Более того, просрочка — штатны
- проверка «чтение-кода»: подтверждает (высокая) — Цитаты совпадают с файлами построчно. occupancy.ts:69-70 в poolSpans: `dateFrom: { lte: toDate(to) }, dateTo: { gte: toDate(from) },`; тот же фильтр в autoconfirm.ts:32-33 (`dateFrom: { lte: toDate(dateTo) }, dateTo: { gte: toDate(dateFrom) }`); heldNow на occupancy.ts:103 — `{ status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } }`, и freeNow = capacity - heldNow (строка 111); on

### src/server/services/occupancy.ts:105 — «Свободно сейчас» складывает пул и фуры: показывает свободными места, которых в пуле нет

*✅ подтверждено* · направление: occupancy

**Что происходит.** Пул занят полностью (405 из 405), фуры пустые. heldNow (строка 103) считает все брони PARKING без фильтра по vehicleType → 405, capacity = 405 + 10 = 415, freeNow = 10. Админ видит «Свободно сейчас 10» и берёт легковую по телефону, хотя в пуле 0. Ошибка систематическая: показанное свободное всегда завышено на (10 − занято фурами). Обратный эффект у баннера: nearLimit в ParkingSummary.tsx:25 сравнивает смешанный held с порогом пула, поэтому при пуле 390 и 10 фурах held = 400 >= 395 и всплывает «новые заявки с сайта отклоняются автоматически», хотя decideSiteBooking при пике 390 их принимает.

**В коде.** `const capacity = settings.capacityTotal + settings.capacityTruck;`

**Правка.** Считать held двумя запросами через poolWhere ("POOL" и "TRUCK"): freeNow = capacityTotal − heldPool, фуры показывать отдельной строкой/плиткой; nearLimit сравнивать с heldPool.

- проверка «воспроизведение»: подтверждает (высокая) — Пытался опровергнуть — не вышло, защиты на пути нет ни одной.  Трасса от входа до дефекта (`/admin/occupancy`): 1. `src/app/admin/(app)/occupancy/page.tsx:22` → `parkingDashboard(today)`. 2. `src/server/services/occupancy.ts:103` — heldNow: `prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } })`. Фильтра `vehicleType` нет — в от
- проверка «чтение-кода»: подтверждает (высокая) — Цитата и строки совпадают дословно. occupancy.ts:105 — `const capacity = settings.capacityTotal + settings.capacityTruck;`; строка 103 считает `prisma.booking.count({ where: { kind: "PARKING", status: { in: [...ACTIVE] }, dateFrom: { lte: t }, dateTo: { gte: t } } })` без фильтра по vehicleType, то есть в held попадают и фуры; строка 111 — `freeNow: Math.max(0, capacity - heldNow)`. ParkingSummary

### src/server/services/occupancy.ts:127 — Полоса занятости дня не считает «Ожидает оплаты» — то есть как раз автоподтверждённые брони

*✅ подтверждено* · направление: occupancy

**Что происходит.** Предоплаты нет, поэтому подтверждённая с сайта бронь живёт в AWAITING_PAYMENT до приезда (decideSiteBooking возвращает именно этот статус, а CONFIRMED ставится только при полной оплате, bookings.ts:addPayment). occupancyToday берёт только CONFIRMED и CHECKED_IN, поэтому при 100 бронях на сегодня, из которых 90 в «Ожидает оплаты», полоса на /admin/boards/PARKING и /admin/today (TodayStrip) покажет «Легк 10/60», а строка «Всего в пуле» на /admin/occupancy за ту же дату — 100. Два числа по одним и тем же данным расходятся втрое.

**В коде.** `where: { kind: "PARKING", status: { in: ["CONFIRMED", "CHECKED_IN"] }, dateFrom: { lte: t }, dateTo: { gte: t } },`

**Правка.** status: { in: [...ACTIVE] } — тот же набор статусов, что в poolSpans и heldNow.

- проверка «воспроизведение»: подтверждает (высокая) — Находка подтверждается по файлам, цитата точная. `src/server/services/occupancy.ts:127`: `where: { kind: "PARKING", status: { in: ["CONFIRMED", "CHECKED_IN"] }, dateFrom: { lte: t }, dateTo: { gte: t } }` — при том, что в том же файле на строке 8 объявлено `const ACTIVE = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"] as const`, и им пользуются `occupancy()` (стр. 26), `poolSpans()` (стр. 68) и `
- проверка «чтение-кода»: подтверждает (высокая) — Цитата совпадает с файлом дословно и строка указана верно. src/server/services/occupancy.ts:127 внутри occupancyToday (объявлена на строке 121): `where: { kind: "PARKING", status: { in: ["CONFIRMED", "CHECKED_IN"] }, dateFrom: { lte: t }, dateTo: { gte: t } },`. Вся цепочка находки подтверждается по файлам: (1) autoconfirm.ts:57 — `return { status: "AWAITING_PAYMENT", reason: "auto" };`, то есть а

### src/server/services/occupancy.ts:99 — «Заезды/выезды за 24 ч» считаются по двум календарным датам и расходятся со списком на /admin/today

*✅ подтверждено* · направление: occupancy

**Что происходит.** Сегодня 22.09: dateFrom между полуночью 22.09 и полуночью 23.09 по DATE-полю — это все заезды 22-го И все заезды 23-го, то есть окно почти 48 часов (бронь на 23.09 в 23:00 попадает в «Заезды за 24 ч»). Одновременно клиент, который должен был заехать 21.09 и ещё не заехал, в плитку не попадает, хотя /admin/today (today/page.tsx:22, dateFrom >= вчера) держит его в заездах. Симметрично departures (строка 101) не видит просроченные выезды (dateTo < сегодня), которые /admin/today показывает (dateTo <= сегодня). Админ планирует смену по числу, которое примерно вдвое больше реальных суток и при этом теряет опоздавших.

**В коде.** `prisma.booking.count({ where: { kind: "PARKING", status: { in: ["AWAITING_PAYMENT", "CONFIRMED"] }, dateFrom: { gte: t, lte: tomorrow } } }),`

**Правка.** Считать по плановому моменту (plannedMoment из dates.ts) в окне 24 ч либо привести к окну /admin/today: заезды — dateFrom <= t и ещё не заехали, выезды — CHECKED_IN с dateTo <= t.

- проверка «воспроизведение»: подтверждает (высокая) — Подтверждается. Цепочка: occupancy/page.tsx:18 `const today = todayIso()` → :22 `parkingDashboard(today)` → occupancy.ts:93-94 `const t = toDate(today); const tomorrow = toDate(addDays(today, 1));` → :99 `dateFrom: { gte: t, lte: tomorrow }`. Колонка не timestamp, а DATE: schema.prisma:302 `dateFrom DateTime @db.Date`, миграция init:164 `"dateFrom" DATE NOT NULL` — значит диапазон [полночь 22-го; 
- проверка «чтение-кода»: подтверждает (высокая) — Проверял враждебно, опровергнуть не удалось — все ссылки точные.  1) Цитата совпадает дословно. `/Users/styserg/Parking24/src/server/services/occupancy.ts:99`: `prisma.booking.count({ where: { kind: "PARKING", status: { in: ["AWAITING_PAYMENT", "CONFIRMED"] }, dateFrom: { gte: t, lte: tomorrow } } }),` Строка указана верно, окрестности (92–104) целиком из ревьюируемого коммита — `git blame` даёт `

### src/server/services/settings.ts:57 — siteLinks опирается на NEXT_PUBLIC_SITE_URL, который на stage вшит пустым на этапе сборки

*⏳ проверка не закончилась* · направление: settings

**Что происходит.** NEXT_PUBLIC_-переменные Next подставляет в код на этапе `next build`, в том числе в серверном бандле (node_modules/next/dist/docs/01-app/02-guides/environment-variables.md:164,166: «replace all references … in the Node.js environment with the value from the environment in which you run next build», «if you build and deploy a single Docker image … frozen with the value evaluated at build time»). В Dockerfile стадия build делает `npm run build` (= plain `next build`) без build-arg, а `.env` и `.env.*` исключены в `.dockerignore`, поэтому при сборке переменной нет; `env_file: .env` в docker-compose действует только в рантайме и на уже подставленное значение не влияет. Итог: `site === ""` → `route === ""` → строка шаблона «Маршрут: {{links.route}}» (docs/MESSAGE_TEMPLATES_2026-09-22.md:43,63) после renderTemplate (trim строки) превращается в «Маршрут:» — ровно тот обрыв, от которого защищается комментарий строкой выше. `links.review` запасного значения не имеет вообще: «Будем благодарны за отзыв, это займёт минуту:» (там же, строка 90). Тот же корень уже действует на живом seed-шаблоне reminder_24h (prisma/seed.ts:89): «Маршрут: {{site.url}}/#route» → «Маршрут: /#route».

**В коде.** `const site = process.env.NEXT_PUBLIC_SITE_URL ?? ""; return { route: str(LINKS.route.key, site ? `${site}/#route` : ""), review: str(LINKS.review.key, "") };`

**Правка.** Держать адрес сайта в настройке БД (рядом с LINKS) или в рантайм-переменной без префикса NEXT_PUBLIC_; и не оставлять голый ярлык — если ссылка пустая, выбрасывать всю строку «Маршрут: …» переменной вида `links.routeLine`, как уже сделано для booking.dueLine.


## Мелочь (10)


### src/app/admin/actions/settings.ts:49 — revalidatePath("/admin", "layout") не попадает в layout внутри группы маршрутов (app)

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** Файл layout лежит по пути src/app/admin/(app)/layout.tsx. В документации Next 16.3 (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md, раздел «Revalidating a Layout path») путь для type: 'layout' задаётся по структуре файлов маршрута и группу надо указывать явно: revalidatePath('/(main)/post/[slug]', 'layout'). Строка "/admin" соответствовала бы файлу app/admin/layout.tsx, которого нет, — вызов ни во что не попадает. Сейчас это не видно только потому, что NoticeBell сразу после действия делает router.refresh(), который перерисовывает текущий маршрут. Но во второй открытой вкладке админки (и на страницах, лежащих в клиентском кэше) бейдж останется старым, и, если кто-то позже уберёт router.refresh как «лишний», гашение колокольчика перестанет работать вообще.

**В коде.** `revalidatePath("/admin", "layout");`

**Правка.** revalidatePath("/admin/(app)", "layout").


### src/components/admin/booking/TransitionButtons.tsx:82 — Кнопка «Отклонить» оформлена как нейтральная, хотя действие разрушительное

*⏳ проверка не закончилась* · направление: statuses

**Что происходит.** Красный стиль adm-btn-danger назначается только CANCELLED и NO_SHOW. Новый переход в REJECTED попадает в ветку else и получает тот же нейтральный adm-btn, что и соседняя «Подтвердить место» — на новой заявке две визуально одинаковые кнопки с противоположным смыслом стоят рядом. Подтверждения (window.confirm), как у NO_SHOW, для «Отклонить» тоже нет, а причина отклонения не спрашивается: transition кладёт rejectReason = opts.reason ?? null, то есть при ручном отклонении причина всегда остаётся пустой.

**В коде.** `className={`${PRIMARY.includes(t) ? "adm-btn-primary" : t === "CANCELLED" \|\| t === "NO_SHOW" ? "adm-btn-danger" : "adm-btn"} ${h}`}`

**Правка.** Включить REJECTED в проверку на adm-btn-danger и в функции go() спрашивать причину через window.prompt, как для CANCELLED, передавая её в reason.


### src/components/admin/kanban/BookingsTable.tsx:12 — В фильтрах таблицы броней нет чипа «Отклонена»

*⏳ проверка не закончилась* · направление: statuses

**Что происходит.** Список STATUSES для кнопок-фильтров перечислен вручную и не содержит REJECTED, поэтому отобрать отклонённые заявки в табличном виде доски нельзя (даже после починки запроса на стр. 28 boards/[kind]/page.tsx они будут показываться только в режиме «Все»). Экспорт CSV при этом ярлык знает — STATUS_SHORT.REJECTED определён.

**В коде.** `const STATUSES: BookingStatus[] = ["NEW", "AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"];`

**Правка.** Добавить "REJECTED" в STATUSES (или собирать список из PIPELINE + TERMINAL, чтобы новый статус подхватывался автоматически).


### src/lib/occupancy-math.ts:38 — Комментарий к fits описывает другое правило, чем код и ТЗ

*⏳ проверка не закончилась* · направление: occupancy

**Что происходит.** Код правильный: проверено прогоном — при пороге 395 занятость 394 проходит (394+1 <= 395 → true), 395 не проходит (false), то есть «подтверждаем, пока занято меньше 395», как в ТЗ (строка 22 плана) и на подписи настройки «Автоподтверждение, пока занято меньше». Комментарий же утверждает обратное («не должны достигать порога»), и следующий, кто будет править этот файл по комментарию, уберёт одно разрешённое место из 405 или, наоборот, решит, что здесь лишняя +1.

**В коде.** `// Помещается ли новая бронь: пик занятости плюс она сама не должны достигать порога.\n...\n  return peakLoad(bookings, from, to) + 1 <= limit;`

**Правка.** Привести комментарий к коду: «заявка проходит, пока занятость меньше порога; заявка, доводящая занятость ровно до порога, проходит».


### src/lib/occupancy-math.ts:41 — При dateTo < dateFrom fits отвечает «место есть» (пустой диапазон читается как ноль занятости)

*⏳ проверка не закончилась* · направление: occupancy

**Что происходит.** Прогон: daysRange("2026-10-05","2026-10-01") = [], peakLoad = 0 (reduce со стартом 0), fits(..., limit 1) = true при полностью занятой стоянке. Сейчас не достижимо — и /api/public/lead (days <= 0), и createBooking, и updateBooking, и quoteAction отсекают перевёрнутые даты раньше; но защита держится только на вызывающих, и любой новый вызов (например, повторная проверка мест при смене дат из этапа 2) получит «место есть» на мусорном диапазоне.

**В коде.** `export function fits(bookings: Span[], from: string, to: string, limit: number): boolean {\n  return peakLoad(bookings, from, to) + 1 <= limit;`

**Правка.** Первой строкой fits: if (to < from) return false;


### src/server/automations/dispatcher.ts:28 — siteLinks ни с чем не соединена: единственный вызов renderTemplate не передаёт extras, а записать links.route/links.review нечем

*✅ подтверждено* · направление: settings

**Что происходит.** `enqueue` — единственное место в src/, где вызывается renderTemplate, и третий аргумент не передаётся, поэтому `extras.route`/`extras.review` всегда undefined → `{{links.route}}` и `{{links.review}}` рендерятся пустыми независимо от того, что вернёт siteLinks. Плюс ключи LINKS (settings.ts:13-16) никто не пишет: grep по setSetting и prisma.setting даёт только parking.* и capacityIsPlaceholder, страницы/действия для ссылок нет. То есть даже когда заказчик пришлёт ссылки, положить их в CRM некуда, а функция останется невызванной (siteLinks не импортируется нигде).

**В коде.** `const renderedText = renderTemplate(templateBody, { booking, client });`

**Правка.** Либо довести до конца в том же коммите — вызвать `siteLinks()` в enqueue и передать третьим аргументом, добавить поля ссылок в CapacityForm/saveCapacityAction, — либо не коммитить siteLinks, пока нет места, откуда её вызовут.

- проверка «воспроизведение»: подтверждает (высокая) — Проверил по файлам, находка подтверждается в своей кодовой части. Единственный боевой вызов — dispatcher.ts:28 `const renderedText = renderTemplate(templateBody, { booking, client });` (grep по renderTemplate даёт только его и тесты), поэтому в render.ts:20 срабатывает дефолт `extras: RenderExtras = {}`, и render.ts:32,38,51,52 (`extras.contract ?? ""`, `extras.checkedInAt ?? ""`, `extras.route ??
- проверка «чтение-кода»: подтверждает (высокая) — Мой угол — точность цитаты и строки — находку НЕ опровергает, цитата дословная. `/Users/styserg/Parking24/src/server/automations/dispatcher.ts:28`: `  const renderedText = renderTemplate(templateBody, { booking, client });` — ровно строка 28, третьего аргумента нет. Механизм тоже подтверждается по файлам: 1) `render.ts:20` — `extras: RenderExtras = {}`, и `render.ts:32,38,51,52` читают ТОЛЬКО отту

### src/server/lib/dates.ts:62 — Время вида «25:00» проходит проверку: fmtDayTime печатает его клиенту, plannedMoment возвращает Invalid Date

*⏳ проверка не закончилась* · направление: render

**Что происходит.** Проверка времени в обеих функциях — `/^\d{2}:\d{2}$/`, она пропускает «25:00» и «99:99»; та же нестрогая проверка стоит в схеме валидации (src/server/validation/booking.ts:4), которая применяется в том числе к публичному `/api/public/lead`. Формой это не ввести (input type=time), но запросом в API — да. Дальше: `fmtDayTime("2026-10-01", "25:00")` даёт клиенту «1 октября, 25:00», а `plannedMoment("2026-10-01", "25:00")` строит `new Date("2026-10-01T25:00:00Z")` = Invalid Date, и `.toISOString()` на нём бросает «Invalid time value» — когда планировщик напоминаний подключат, одна такая строка уронит проход по всем броням. Обе функции задумывались с запасным 12:00, но запасной путь на такие значения не срабатывает.

**В коде.** `const [hh, mm] = (time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00").split(":").map(Number);`

**Правка.** Завести одну общую проверку `/^([01]\d|2[0-3]):[0-5]\d$/` и использовать её в fmtDayTime, plannedMoment и в `const time` в src/server/validation/booking.ts:4.


### src/server/services/autoconfirm.ts:18 — Правило «какие статусы занимают место» и запрос занятости пула продублированы в двух модулях

*⏳ проверка не закончилась* · направление: concurrency

**Что происходит.** ACTIVE объявлен в occupancy.ts:8 и второй раз в autoconfirm.ts:18, а poolPeak (autoconfirm.ts:26-39) повторяет poolSpans (occupancy.ts:64) с тем же where. Сегодня списки совпадают, но при любой правке правила в одном месте (например, если место начнут держать за NEW сутки или за перестои из предыдущей находки) панель занятости и автоподтверждение начнут считать по-разному, и расхождение не поймают тесты: tests/unit/occupancy-math.test.ts проверяет только чистые функции, без запросов. Это прямо против правила раздела 3 ТЗ «одно правило в одном месте».

**В коде.** `const ACTIVE: BookingStatus[] = ["AWAITING_PAYMENT", "CONFIRMED", "CHECKED_IN"];   // autoconfirm.ts:18, копия occupancy.ts:8`

**Правка.** Экспортировать ACTIVE и выборку пролётов пула из occupancy.ts с параметром клиента (tx | prisma) и вызывать её из decideSiteBooking вместо локальной копии.


### src/server/services/leads.ts:101 — Уведомление об автоотклонении создаётся вне транзакции брони — может не создаться вовсе

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** createBooking уже закоммитил бронь со статусом REJECTED, и только после этого делается отдельный insert в AdminNotice на глобальном prisma. Если этот insert падает (обрыв соединения, исчерпан пул под нагрузкой), createSiteLead бросает, route.ts возвращает 500, клиент видит «Ошибка сервера» — при том что отклонённая бронь в базе уже есть, а уведомления администратору нет. Ровно тот случай, ради которого уведомление и заводили: заявка потеряна молча. Функция notify уже принимает tx четвёртым параметром (notices.ts:6), так что атомарность стоит ноль правок в сигнатурах.

**В коде.** `await notify("BOOKING_REJECTED", `Заявка №${booking.number} отклонена: на выбранные даты нет мест (${lead.dateFrom} → ${lead.dateTo})`, booking.id);`

**Правка.** Создавать уведомление внутри той же транзакции — прокинуть tx в createBooking (там же, где пишется SYSTEM-интеракция, bookings.ts:83–85) и вызывать notify(..., tx). Заодно форматировать даты по Москве (fmtRange), сейчас в текст уходит сырой ISO «2026-09-25 → 2026-09-28».


### src/server/services/settings.ts:50 — siteLinks() написана, но никуда не подключена: {{links.route}} и {{links.review}} в сообщениях всегда пустые

*⏳ проверка не закончилась* · направление: ui

**Что происходит.** Поиск по src даёт единственное вхождение — само объявление, вызовов нет. renderTemplate принимает extras третьим параметром, но его единственный боевой вызов (src/server/automations/dispatcher.ts:28: renderTemplate(templateBody, { booking, client })) передаёт только два аргумента, то есть extras = {}. Значит в реально отправляемом тексте {{links.route}}, {{links.review}}, {{booking.contract}} и {{booking.checkedInAt}} всегда раскрываются в пустую строку — переменные из коммита cfdcae4 проверены только юнит-тестами (tests/unit/render.test.ts:83), где extras передают руками. Пока шаблоны в базе (prisma/seed.ts) этих переменных не используют, поэтому клиенту ничего не ломается, но как только заказчик вставит {{links.route}} в шаблон — получит строку «Маршрут проезда:» без ссылки.

**В коде.** `export async function siteLinks(): Promise<SiteLinks> {`

**Правка.** Либо дотянуть цепочку в этом же коммите — вызвать siteLinks() в enqueue и передать её в renderTemplate третьим аргументом, либо не коммитить siteLinks, пока подключать некуда. В любом случае добавить тест уровня dispatcher, который ловит подстановку ссылок в Outbox.renderedText, а не только renderTemplate напрямую.

