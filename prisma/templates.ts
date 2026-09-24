// Тексты сообщений клиенту для seed. Лежат в prisma/, а не в src/: в рабочий образ копируется только эта папка.
// Редакция 3 (docs/MESSAGE_TEMPLATES_2026-09-22.md): строгий вид, без эмодзи и разметки.
// МФ-2: seed ведёт текст, пока его не правили в CRM (MessageTemplate.editedAt); правленый не трогает никогда.
// Текст поставки seed всегда кладёт в defaultName/defaultBody — по нему «Вернуть текст поставки».

// Окончательная форма записи (Ф5–Ф7 добавляют записи в конец TEMPLATES в этой форме)
export type SeedTemplate = { code: string; name: string; body: string };

// Сообщение 1 при переходе в «Ожидает оплаты»: автоподтверждение или «Подтвердить место» администратором
const PLACE_BOOKED = `{{greeting.hello}}
Это парковка «Питстоп» у Шереметьево.

Ваше место забронировано.

Бронь № {{booking.number}}
Заезд: {{booking.arrival}}
Выезд: {{booking.departure}}
Автомобиль: {{booking.vehicle}}
{{booking.priceLine}}

Предоплата не нужна — оплатите на месте, наличными или картой.
При оформлении понадобятся СТС и водительское удостоверение.

Адрес: Московская область, г.о. Химки, село Чашниково.
Маршрут: {{links.route}}
{{booking.transferLine}}

Советуем приехать за 3 часа до вылета.
Если планы изменятся, ответьте на это сообщение или позвоните: +7 905 525-06-60. Мы на связи круглосуточно.`;

// Тот же текст для «Подтверждена» (оплачена): вместо «предоплата не нужна» — строка долга,
// потому что администратор может завести бронь сразу оплаченной
const BOOKING_CONFIRMED = PLACE_BOOKED.replace("Предоплата не нужна — оплатите на месте, наличными или картой.", "{{booking.dueLine}}");

const REMINDER_24H = `{{greeting.name}}напоминаем: завтра ждём вас на парковке «Питстоп».

Бронь № {{booking.number}}
Заезд: {{booking.arrival}}
{{booking.dueLine}}

Возьмите с собой СТС и водительское удостоверение.
Приезжайте за 3 часа до вылета: оформление на ресепшене занимает несколько минут, до терминалов 3–5 минут езды.

Адрес: Московская область, г.о. Химки, село Чашниково.
Маршрут: {{links.route}}

Задерживаетесь или планы изменились? Ответьте на это сообщение или позвоните: +7 905 525-06-60.`;

// Заявка с сайта, которую система не подтвердила сама (автоподтверждение выключено, фура)
const NEW_LEAD_REPLY = `{{greeting.hello}}
Это парковка «Питстоп» у Шереметьево.

Заявка № {{booking.number}} принята.
Заезд: {{booking.arrival}}
Выезд: {{booking.departure}}
Автомобиль: {{booking.vehicle}}

Администратор проверяет свободные места. Подтверждение придёт в этот чат через несколько минут.
Если есть вопросы, позвоните: +7 905 525-06-60. Мы на связи круглосуточно.`;

// Ф5: отказ «мест нет» — автоотклонение и кнопка «Мест нет» (ТЗ 1.2)
const REJECT_NO_SPACE = `{{greeting.hello}}
К сожалению, на выбранные даты свободных мест нет, поэтому бронь не подтверждена.

Заявка № {{booking.number}}
Даты: {{booking.dates}}

Будем рады видеть вас в другие даты. Подобрать свободные — ответьте на это сообщение или позвоните: +7 905 525-06-60.`;

// Ф5: отказ по другой причине — кнопка «Отклонить» (ТЗ 2)
const REJECT_OTHER = `{{greeting.hello}}
К сожалению, ваша заявка № {{booking.number}} отклонена.

Будем рады видеть вас в другие даты. Ответьте на это сообщение или позвоните: +7 905 525-06-60.`;

// Ф5: «Заехал» (ТЗ 2.3). Черновик: текст Влада заказчик вставит на странице «Шаблоны»
const CHECKIN_ACCEPTED = `{{greeting.name}}автомобиль принят на стоянку. Спасибо, что выбрали «Питстоп».

Бронь № {{booking.number}}
Договор № {{booking.contract}}
Автомобиль: {{booking.vehicle}}
Принят: {{booking.checkedInAt}}
Плановый выезд: {{booking.departure}}

{{booking.returnLine}}
Вернётесь раньше или позже срока — сообщите нам, пересчитаем стоимость по фактическим суткам.

Хорошего полёта!`;

// Ф5: через 2 часа после «Выехал». Пока ссылки на отзывы нет, строка про отзыв выпадает
const CHECKOUT_THANKS = `{{greeting.name}}спасибо, что доверили нам автомобиль. Надеемся, поездка прошла хорошо.

Будем благодарны за отзыв, это займёт минуту: {{links.review}}
Если что-то было не так, напишите нам прямо сюда — разберёмся.

Будем рады видеть вас снова: {{site.url}}`;

export const TEMPLATES: SeedTemplate[] = [
  { code: "booking_confirmed", name: "Бронь подтверждена", body: BOOKING_CONFIRMED },
  { code: "reminder_24h", name: "Напоминание за 24 ч", body: REMINDER_24H },
  { code: "extension_offer", name: "Предложение продления", body: "Ваша бронь №{{booking.number}} заканчивается {{booking.dateTo}}. Нужно продлить? Ответьте на это сообщение или позвоните +7 905 525-06-60." },
  // Ссылка отдельной строкой: без адреса сайта выпадает только она
  { code: "thanks_discount", name: "Спасибо + скидка", body: "Спасибо, что выбрали Питстоп! В следующий раз — скидка 10% по этому сообщению.\nБронируйте: {{site.url}}" },
  // Флоу сайта (правка заказчика 10.09): клиент ничего не пишет сам — первым пишет Питстоп
  { code: "new_lead_reply", name: "Заявка с сайта принята", body: NEW_LEAD_REPLY },
  { code: "awaiting_payment", name: "Место забронировано", body: PLACE_BOOKED },
  { code: "reject_no_space", name: "Отказ: мест нет", body: REJECT_NO_SPACE },
  { code: "reject_other", name: "Заявка отклонена", body: REJECT_OTHER },
  { code: "checkin_accepted", name: "Автомобиль принят", body: CHECKIN_ACCEPTED },
  { code: "checkout_thanks", name: "Спасибо и отзыв", body: CHECKOUT_THANKS },
];

// ── Решения seed (чистые: базы здесь нет, их проверяют юнит-тесты) ──

export type TemplateRow = { name: string; body: string; defaultName: string | null; defaultBody: string | null; editedAt: Date | null };
export type TemplateSyncPlan = { writeDefault: boolean; writeText: boolean };

// Пишем только при различии: холостая запись сдвигала бы updatedAt при каждом старте контейнера
export function planTemplateSync(tpl: SeedTemplate, row: TemplateRow): TemplateSyncPlan {
  return {
    writeDefault: row.defaultBody !== tpl.body || row.defaultName !== tpl.name,
    writeText: row.editedAt === null && (row.body !== tpl.body || row.name !== tpl.name),
  };
}

// Правило в каталоге seed. active — только при создании (Ф5 привозит правила выключенными).
// kind — такое же условие срабатывания, как triggerParams (правило только для парковки): seed ведёт его всегда
export type SeedRule = {
  code: string;
  name: string;
  trigger: string;
  triggerParams: Record<string, unknown>;
  templateId: string | null;
  active?: boolean;
  kind?: "PARKING" | null;
};
export type RuleRow = { name: string; trigger: string; triggerParams: unknown; templateId: string | null; kind?: string | null };
export type RulePatch = Partial<Pick<SeedRule, "name" | "trigger" | "triggerParams" | "templateId" | "kind">>;

// Условия, название и шаблон правила ведёт seed всегда. isActive при обновлении не пишет никогда:
// выключатель — решение человека в CRM (editedAt), иначе выкатка включала бы выключенное обратно.
// Исключение — список «выключено решением» шага 0 Ф4: он сильнее ручного включения (сводится при слиянии)
export function planRuleSync(rule: SeedRule, row: RuleRow): RulePatch {
  const patch: RulePatch = {};
  if (row.trigger !== rule.trigger) patch.trigger = rule.trigger;
  if (!sameJson(row.triggerParams, rule.triggerParams)) patch.triggerParams = rule.triggerParams;
  if (row.name !== rule.name) patch.name = rule.name;
  if (row.templateId !== rule.templateId) patch.templateId = rule.templateId;
  if ((row.kind ?? null) !== (rule.kind ?? null)) patch.kind = rule.kind ?? null;
  return patch;
}

// JSON из базы (jsonb) приходит с ключами в другом порядке — сравниваем без учёта порядка
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  // Ключ со значением undefined jsonb не хранит — иначе «правка» находилась бы при каждом прогоне
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v ?? null;
}
