"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCollectionAction } from "@/app/admin/actions/cash";

// ТЗ 7.4: сумма, кто забрал, кто передал; время и смену ставит система
export default function CollectionForm({ shiftId, me }: { shiftId: string; me: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [takenBy, setTakenBy] = useState("");
  const [handedBy, setHandedBy] = useState(me);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    start(async () => {
      const r = await addCollectionAction({ shiftId, amount: Number(amount), takenBy, handedBy });
      if (!r.ok) return setErr(r.error);
      setAmount("");
      setTakenBy("");
      router.refresh();
    });
  }
  return (
    <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-3">
      <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Сумма, ₽" aria-label="Сумма инкассации" className="adm-input h-10 font-mono" />
      <input value={takenBy} onChange={(e) => setTakenBy(e.target.value)} placeholder="Кто забрал деньги" aria-label="Кто забрал" maxLength={100} className="adm-input h-10 text-sm" />
      <input value={handedBy} onChange={(e) => setHandedBy(e.target.value)} placeholder="Кто передал деньги" aria-label="Кто передал" maxLength={100} className="adm-input h-10 text-sm" />
      {err && <p className="adm-err sm:col-span-3">{err}</p>}
      <div className="sm:col-span-3">
        <button type="submit" disabled={pending || !amount || takenBy.trim().length < 2 || handedBy.trim().length < 2} className="adm-btn-primary h-10 px-4 text-sm">{pending ? "…" : "Провести инкассацию"}</button>
      </div>
    </form>
  );
}
