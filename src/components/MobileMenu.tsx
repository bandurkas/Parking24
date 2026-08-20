"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Menu, Phone, X } from "lucide-react";
import { PHONE, PHONE_HREF } from "@/lib/tariffs";

const NAV = [
  { href: "/#tariffs", label: "Тарифы" },
  { href: "/rooms", label: "Комнаты отдыха" },
  { href: "/#gallery", label: "Наша стоянка" },
  { href: "/#directions", label: "Как добраться" },
  { href: "/#faq", label: "Частые вопросы" },
  { href: "/#contacts", label: "Контакты" },
];

export default function MobileMenu() {
  const [open, setOpen] = useState(false);

  // Портал в body: header с backdrop-blur становится containing block
  // для fixed-потомков, и inset-0 считался бы от коробки хедера.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Открыть меню"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-white text-ink"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-white p-4 lg:hidden">
            <div className="flex items-center justify-between">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/emblem-color.svg"
                alt="Паркинг 24 Питстоп"
                className="h-11 w-auto"
              />
              <button
                type="button"
                aria-label="Закрыть меню"
                onClick={() => setOpen(false)}
                className="flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line text-ink"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <nav aria-label="Мобильное меню" className="mt-6 flex flex-col divide-y divide-line">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="py-4 text-lg font-semibold text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-auto grid gap-3 pb-4">
              <a
                href={PHONE_HREF}
                className="tnum flex h-13 items-center justify-center gap-2 rounded-xl border border-line text-[15px] font-semibold text-ink"
              >
                <Phone className="size-4" aria-hidden />
                {PHONE}
              </a>
              <Link
                href="/#booking"
                onClick={() => setOpen(false)}
                className="flex h-13 items-center justify-center rounded-xl bg-cta text-[15px] font-semibold text-ink"
              >
                Забронировать место
              </Link>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
