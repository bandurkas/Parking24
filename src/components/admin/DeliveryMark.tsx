// Отметка доставки из вебхука Wazzup рядом со статусом очереди (Ф14). Строка уже готова и по Москве
export default function DeliveryMark({ mark }: { mark: { text: string; bad: boolean } | null }) {
  if (!mark) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 font-semibold normal-case ${mark.bad ? "bg-danger/8 text-danger" : "bg-success/12 text-[#0b7a4c]"}`} data-testid="delivery-mark">
      {mark.text}
    </span>
  );
}
