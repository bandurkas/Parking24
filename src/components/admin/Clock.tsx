"use client";

import { useEffect, useState } from "react";

export default function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="w-24" />;
  const date = now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="hidden items-baseline gap-2 font-mono text-sm text-ink-muted md:flex">
      <span>{date}</span>
      <span className="text-base font-semibold text-ink">{time}</span>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
    </span>
  );
}
