// Нормализация телефона в E.164 (+7XXXXXXXXXX). Ключ дедупликации клиентов.
export function normalizePhone(raw: string, defaultDial = "7"): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let d = digits;
  if (d.length === 10) d = defaultDial + d;
  else if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("7")) {
    return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
  }
  return e164;
}

// Госномер: убираем пробелы, латиницу приводим к кириллице-двойникам, верхний регистр.
const LAT_TO_CYR: Record<string, string> = {
  A: "А", B: "В", E: "Е", K: "К", M: "М", H: "Н", O: "О", P: "Р", C: "С", T: "Т", Y: "У", X: "Х",
};
export function normalizePlate(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[A-Z]/g, (ch) => LAT_TO_CYR[ch] ?? ch);
}

// А123ВС77 → { left: "А123ВС", region: "77" }
export function splitPlate(plate: string): { left: string; region: string } {
  const m = plate.match(/^([А-ЯA-Z]\d{3}[А-ЯA-Z]{2})(\d{2,3})$/i);
  if (m) return { left: m[1], region: m[2] };
  const m2 = plate.match(/^(.*?)(\d{2,3})$/);
  if (m2 && plate.length > 4) return { left: m2[1], region: m2[2] };
  return { left: plate, region: "" };
}
