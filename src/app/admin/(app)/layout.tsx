import type { Metadata } from "next";
import { requireUser } from "@/server/auth/guard";
import AdminShell from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Паркинг 24 · CRM",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(["OWNER", "ADMIN"]);
  return <AdminShell user={user}>{children}</AdminShell>;
}
