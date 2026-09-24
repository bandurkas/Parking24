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
        Новая цена действует для новых броней и расчётов в CRM. Уже созданные брони не пересчитываются. Долг за перестой считается по текущей
        цене — изменение цены меняет долг у машин, которые сейчас в перестое.
      </p>
      <TariffsForm title="Парковка" rows={parking} unitLabel={UNIT} />
      <TariffsForm title="Комнаты отдыха" rows={rooms} unitLabel={UNIT} />
      <p className={`mt-4 text-sm ${mismatch ? "font-semibold text-danger" : "text-ink-muted"}`}>
        Цены на сайте пока задаются в коде. Изменение здесь влияет на расчёты в CRM и на долг за перестой, но не на калькулятор сайта.
      </p>
    </div>
  );
}
