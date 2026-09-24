// Номер договора хранения (Ф5): в карточке и в сообщении — «001». Нет номера — null, строка «Договор №» выпадает из текста
export function formatContract(n: number | null | undefined): string | null {
  return typeof n === "number" && n > 0 ? String(n).padStart(3, "0") : null;
}
