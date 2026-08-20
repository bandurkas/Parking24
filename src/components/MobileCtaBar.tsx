"use client";

import { useEffect, useState } from "react";

// Нижняя CTA-панель (<md): прячется, пока калькулятор #booking в вьюпорте — иначе два «Забронировать» в одном экране
export default function MobileCtaBar({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = document.getElementById("booking");
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setHidden(e.isIntersecting),
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-line bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur transition-transform duration-300 md:hidden ${
        hidden ? "translate-y-full" : "translate-y-0"
      }`}
    >
      {children}
    </div>
  );
}
