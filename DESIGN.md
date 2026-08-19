---
name: Parking24 Pitstop
description: Охраняемая парковка у Шереметьево — фирменная система «оранжевый + сталь + белый» (утверждена заказчиком 20.08.2026)
colors:
  runway-orange: "#f56a1a"
  runway-orange-deep: "#d9570d"
  runway-orange-soft: "#fff3e9"
  steel-livery: "#71778f"
  tower-steel-dark: "#343a46"
  runway-white: "#ffffff"
  morning-haze: "#f4f5f7"
  asphalt-ink: "#171a1f"
  jet-stream-gray: "#6b7280"
  hairline-steel: "#e3e6eb"
  cleared-green: "#0ea968"
  hold-amber: "#f5a300"
  cancelled-red: "#e23d3d"
typography:
  display:
    fontFamily: "Golos Text, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.15
  headline:
    fontFamily: "Golos Text, system-ui, -apple-system, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Golos Text, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Golos Text, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Golos Text, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.45
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.runway-orange}"
    textColor: "{colors.runway-white}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.runway-orange-deep}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.runway-orange}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "48px"
  chip:
    backgroundColor: "{colors.morning-haze}"
    textColor: "{colors.jet-stream-gray}"
    rounded: "{rounded.full}"
    padding: "6px 16px"
  card:
    backgroundColor: "{colors.runway-white}"
    rounded: "{rounded.lg}"
    padding: "24px"
  input:
    backgroundColor: "{colors.morning-haze}"
    textColor: "{colors.asphalt-ink}"
    rounded: "{rounded.md}"
    height: "48px"
    padding: "0 12px"
---

# Design System: Parking24 Pitstop

## Overview

**Creative North Star: "Синий терминал"**

Сайт ведёт себя как навигация хорошего аэропортового терминала: белый воздух, синие «указатели», крупные читаемые цифры. Пользователь — водитель с телефоном, часто на трассе и при ярком солнце; каждый экран должен работать как табло вылетов — взглянул, понял, пошёл. Отсюда светлая основа, модульные карточки, один сильный акцентный цвет и цены, которые невозможно не заметить. Ориентир тона — moskva.mts.ru: деловой и дружелюбный, без канцелярита и без «премиальной» темноты.

Компоненты крупные и уверенные: полноразмерные CTA, большие тач-зоны, жирные табличные цифры — под палец водителя, а не под курсор дизайнера. Глубина — «мягкое парение»: карточки чуть приподняты над белым амбиентной синеватой тенью; тень создаёт атмосферу, а не иерархию.

**Key Characteristics:**
- Светлый, воздушный, mobile-first от 360px (читается на солнце, работает на 3G)
- Один акцент — терминальный синий; всё синее интерактивно
- Крупная типографика Golos Text, табличные цифры в ценах
- Модульные карточки 16px с мягкой navy-тенью на белом
- Тёмно-синий navy — только «якорные» поверхности: футер, промо-карточки, будущий сайдбар CRM

## Colors

Палитра терминала: много белого, один командный синий, приглушённая сине-серая типографика и строгая светофорная семантика статусов.

### Primary
- **Runway Orange** (#f56a1a): единственный акцент. Primary-CTA, цены, активный переключатель, «Мы присмотрим.» в hero, промо не входит. Всё, что окрашено в него, обязано быть действием или ценой; иконки и вторичные кнопки — НЕ оранжевые.
- **CTA Orange** (#c4530a, токен `--color-cta`, hover `--color-cta-dark` #a84607): фон ВСЕХ кнопок с белым текстом — контраст 4.58:1, WCAG AA (решение заказчика 20.08 по итогам независимого аудита). Светлый #f56a1a на кнопках больше не используется.
- **Runway Orange Deep** (#d9570d): текст бейджей на подложке Runway Orange Soft (#fff3e9, контраст 3.6:1) и «Мы присмотрим.» в hero (3.95:1 large).
- **Steel Livery** (#71778f, из логотипа): иконки, серые подложки-плашки, нейтральные полосы карточек.

### Secondary
- **Tower Steel Dark** (#343a46): тяжёлые якорные поверхности — футер, тёмные промо-карточки (градиент от #4a5162), CTA-полоса перед футером. Никогда не для текста на белом (для текста — Asphalt Ink). Правило слоёв: у страницы три тёмных якоря (низ hero-фото, промо, CTA+футер) и чередование белый/серый у секций — нет двум белым подряд.

### Neutral
- **Runway White** (#ffffff): фон страницы и карточек.
- **Morning Haze** (#f3f6fb): подложки чередующихся секций, поля форм, чипы.
- **Asphalt Ink** (#131a24): основной текст.
- **Jet Stream Gray** (#5a6b80): вторичный текст, подписи. Не использовать на Morning Haze для текста мельче 14px (контраст).
- **Hairline Blue** (#e1e8f2): границы карточек, разделители, неактивные точки слайдеров.

### Semantic
- **Cleared Green** (#0ea968): оплачено, возврат выполнен, свободно.
- **Hold Amber** (#f5a300): ожидает оплаты, предупреждения (GPS-плашка).
- **Cancelled Red** (#e23d3d): отмена, ошибка, занято.

### Named Rules
**The Signpost Rule.** Синий = интерактив или цена. Заголовок, бейдж или иконка, окрашенные в Terminal Blue, но не кликабельные и не являющиеся ценой — ошибка системы.
**The One Voice Rule.** Один primary CTA на экран; вторичные действия — outline или текстовая ссылка. Primary-заливка у некликабельного элемента запрещена.

## Typography

**Display/Body Font:** Golos Text (fallback: system-ui, -apple-system, sans-serif)

**Character:** Кириллический гротеск с открытым дружелюбным рисунком и отличной читаемостью на солнце. Один шрифт на всё; иерархия строится весом и размером, а не сменой гарнитуры.

### Hierarchy
- **Display** (700, clamp(2.25rem→3rem), 1.15): только hero-слоган «Паркуйтесь. Летите. Мы присмотрим.»
- **Headline** (700, 1.875rem, 1.2): заголовки секций (H2). На десктопе ≥1024px допускается 2.25rem.
- **Title** (600, 1.125rem, 1.4): заголовки карточек (H3).
- **Body** (400, 1rem, 1.625): основной текст; строка 65–75 знаков.
- **Label** (500, 0.875rem, 1.45): подписи полей, чипы, вторичные строки. Минимум для текста — 12px (только юридические сноски).

### Named Rules
**The Departure Board Rule.** Каждая цена набирается табличными цифрами (`font-variant-numeric: tabular-nums`), с ₽ и единицей («/сутки», «/12 ч»). Цена — самый жирный элемент своей карточки.

## Layout

Контейнер `max-w-6xl` (1152px) с боковыми полями 16px. Сетка модульных карточек: 1–2 колонки на мобиле, 3–4 на десктопе, зазор 12–16px. Ритм из 8px-шкалы; вертикальный шаг секций — 48px (моб) / 56–64px (десктоп), одинаковый у всех секций. Секции чередуются фонами Runway White / Morning Haze для членения без линий. Mobile-first от 360px: нижняя закреплённая панель CTA («Забронировать» + «Позвонить»), горизонтальные снап-слайдеры с peek ~22% и точками-индикаторами вместо сеток. Никакого горизонтального скролла страницы.

## Elevation & Depth

Принцип «мягкого парения»: карточки чуть приподняты над белым амбиентной тенью, подкрашенной navy (не чёрной), плюс тонкая граница Hairline Blue. Тень — атмосфера, а не иерархия: уровней вложенности теней нет, hover не увеличивает тень и не двигает layout. Тяжесть и глубина передаются тональными слоями: White → Morning Haze → Navy.

### Shadow Vocabulary
- **card** (`box-shadow: 0 8px 24px rgba(11, 45, 91, 0.08)`): все карточки на белом/светлом фоне.
- **card-lg** (`box-shadow: 0 16px 48px rgba(11, 45, 91, 0.14)`): единственный «главный» плавающий элемент экрана — карточка калькулятора в hero.

### Named Rules
**The Soft-Float Rule.** Ровно два уровня тени. Третий уровень не изобретается; если элементу нужно больше веса — он становится navy-поверхностью.

## Shapes

Спокойная скруглённость без игрушечности: карточки и крупные поверхности — 16px; кнопки, поля, инфо-плашки — 12px; чипы и точки — full (999px); мелкие вложенные элементы (иконки-плитки) — 8px. Границы 1px Hairline Blue (у outline-кнопок — 2px Terminal Blue). Фото всегда обрезаются в радиус 16px, без рамок.

## Components

### Buttons
- **Shape:** скругление 12px, высота 44–52px (главные CTA — 52px), текст 15px/600.
- **Primary:** заливка Terminal Blue, белый текст; hover → Terminal Blue Deep (только цвет, 200ms); focus-visible — внешнее синее кольцо с отступом 2px.
- **Outline:** прозрачная, граница 2px Terminal Blue, синий текст; hover — инверсия в заливку.
- **Мобильная пара:** в фиксированной нижней панели всегда primary «Забронировать» + outline «Позвонить», высота 48px.

### Chips
- **Style (услуги):** белые пилюли (999px) с рамкой Hairline Blue и тенью card; слева иконка-плитка 40px (скругление 12px, заливка primary/10, lucide-иконка 20px Terminal Blue), текст 15px/500 Asphalt Ink. Десктоп — сетка равношироких пилюль 3×2, мобайл — горизонтальная лента.
- **Мелкие факт-чипы:** пилюли на Morning Haze, текст Jet Stream Gray 14px/500 (допуслуги комнат, бейджи).
- **Hero-вариант:** на фото — белый 15% с blur, белый текст.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Runway White на любом фоне; промо-карточки — Night Approach Navy с белым текстом.
- **Shadow Strategy:** card (см. Elevation), + граница Hairline Blue.
- **Internal Padding:** 16px (моб) / 24px (десктоп).
- **Тарифная карточка (сигнатура):** белая карточка с полосой Terminal Blue 6px по нижнему краю — «синий указатель» системы.

### Inputs / Fields
- **Style:** заливка Morning Haze, граница 1px Hairline Blue, радиус 12px, высота 48px, текст 15px; подпись сверху — Label с lucide-иконкой 16px.
- **Focus:** граница Terminal Blue + кольцо rgba(10,108,255,0.25) 2px.

### Navigation
- **Header:** sticky, белый 95% + blur, нижняя граница Hairline Blue, высота 64px; ссылки 15px/500 Asphalt Ink, hover → Terminal Blue; справа телефон (tabular) и primary-кнопка.
- **Слайдеры:** точки 8px, активная Terminal Blue, неактивные Hairline Blue.

### Signature: карточка калькулятора
Белая карточка 16px с тенью card-lg поверх hero-фото: заголовок Terminal Blue, поля дат/типа авто, крупная синяя цена (tabular), полноширинная CTA и мелкий юридический текст. Это «стойка регистрации» сайта — паттерн переиспользуется визардом брони и виджетом оплаты.

## Do's and Don'ts

### Do:
- **Do** держи один primary CTA на экран (The One Voice Rule); всё остальное — outline или ссылка.
- **Do** набирай каждую цену tabular-nums, жирной, с ₽ и единицей (The Departure Board Rule).
- **Do** используй единый набор lucide-иконок stroke 2px; акцентная подача — иконка 20px Terminal Blue в плитке 40px с заливкой primary/10. Золото (Hold Amber) — только звёзды рейтинга.
- **Do** чередуй фоны секций White/Haze и держи единый вертикальный шаг секций (48/56–64px).
- **Do** проверяй каждый экран на 360px с нижней CTA-панелью и тач-зонами ≥44px.

### Don't:
- **Don't** не крась в Terminal Blue ничего некликабельного, кроме цен (The Signpost Rule) — заголовки карточек остаются Asphalt Ink.
- **Don't** не делай тёмных «премиальных» лендингов и градиентной пестроты — navy только якорные поверхности.
- **Don't** не вводи третий уровень тени и hover-эффекты, двигающие layout (The Soft-Float Rule).
- **Don't** не используй эмодзи вместо иконок и серый текст на сером фоне мельче 14px.
- **Don't** не выдумывай контент: счётчики броней, отзывы и цифры — только из реальных данных (см. PRODUCT.md).
