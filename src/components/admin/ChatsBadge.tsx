"use client";

import { useEffect, useState } from "react";

// Неотвеченные в Wazzup у пункта «Чаты». Опрос раз в минуту; на сервере кеш 30 с — Wazzup не дёргаем чаще
export default function ChatsBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/admin/chats/unanswered", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count?: number } | null) => alive && setCount(typeof d?.count === "number" ? d.count : 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (count <= 0) return null;
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-danger px-1.5 font-mono text-[10px] font-bold leading-5 text-white" data-testid="chats-unanswered" aria-label={`Неотвеченных: ${count}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
