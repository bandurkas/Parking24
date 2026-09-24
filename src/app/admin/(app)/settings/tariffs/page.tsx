import { requireUser } from "@/server/auth/guard";
import { tariffsForSettings } from "@/server/services/tariff-admin";
import SettingsBack from "@/components/admin/settings/SettingsBack";
import TariffsForm from "@/components/admin/settings/TariffsForm";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = { day: "за сутки", "24h": "за 24 часа", "12h": "за 12 часов" };

export default async function TariffsPage() {
  await requireUser(["OWNER"]);
  const rows = await tariffsForSettings();
  const parking = rows.filter((t) => t.kind === "PARKING");
  const rooms = rows.filter((t) => t.kind === "ROOM");
  const mismatch = rows.some((t) => t.sitePrice !== null && t.sitePrice !== t.price);
  return (
    <div className="mx-auto max-w-3xl">
      <SettingsBack />
      <h1 className="mt-1 text-xl font-bold">Тарифы</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Сумма уже созданной брони сама не меняется. По новой цене считаются: новые брони — и в CRM, и заявки с сайта, — «Пересчитать по факту»,
        «Продлить» и долг за перестой (у машин, которые сейчас в перестое, долг изменится сразу).
      </p>
      <TariffsForm title="Парковка" rows={parking} unitLabel={UNIT} />
      <TariffsForm title="Комнаты отдыха" rows={rooms} unitLabel={UNIT} />
      <p className={`mt-4 text-sm ${mismatch ? "font-semibold text-danger" : "text-ink-muted"}`}>
        Калькулятор на сайте показывает цены, заданные в коде (подпись «на сайте» у каждой строки), а бронь по заявке с сайта считается по цене
        отсюда. Если цены разошлись, клиент увидит на сайте одну сумму, а в брони и в сообщении будет другая — сайт правится отдельно.
      </p>
    </div>
  );
}
