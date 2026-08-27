"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

export default function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative hidden w-72 sm:block"
    >
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Телефон, номер авто, № брони…"
        className="adm-input h-9 pl-9 text-sm"
        aria-label="Поиск"
      />
    </form>
  );
}
