// Данные меню отдельно от компонентов (МФ-UI §5.6).
// Ф11/Ф13 при сдаче переключают ready на true здесь — одна строка.
import {
  BarChart3,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  Car,
  KeyRound,
  LayoutGrid,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; ready: boolean };
export type NavGroup = { title?: string; ownerOnly?: boolean; items: NavItem[] };

export const NAV: NavGroup[] = [
  { items: [
    { href: "/admin/boards/parking", label: "Парковка", icon: Car, ready: true },
    { href: "/admin/today", label: "Сегодня", icon: CalendarDays, ready: true },
    { href: "/admin/boards/rooms", label: "Комнаты", icon: BedDouble, ready: true },
    { href: "/admin/clients", label: "Клиенты", icon: Users, ready: true },
    { href: "/admin/occupancy", label: "Занятость", icon: LayoutGrid, ready: true },
  ]},
  { title: "Смена", items: [
    { href: "/admin/cash", label: "Касса", icon: Wallet, ready: true },        // Ф11
    { href: "/admin/staff", label: "Табель", icon: CalendarCheck, ready: false }, // Ф13
  ]},
  { title: "Владелец", ownerOnly: true, items: [
    { href: "/admin/dashboard", label: "Отчёты", icon: BarChart3, ready: true },
    { href: "/admin/audit", label: "Журнал", icon: ScrollText, ready: true },
    { href: "/admin/settings", label: "Настройки", icon: Settings, ready: true },
  ]},
  // МФ-2: свой пароль — владелец и администраторы; остальным пароль задаёт владелец в «Настройках»
  { title: "Аккаунт", items: [
    { href: "/admin/account", label: "Мой пароль", icon: KeyRound, ready: true },
  ]},
];

// Вне групп: подвал Sidebar и лист «Ещё»
export const GUARD_SCREEN = { href: "/admin/today?guard=1", label: "Экран охраны", icon: ShieldCheck };
