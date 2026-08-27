import type { SessionUser } from "@/server/auth/session";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import QuickBookingDrawer from "./QuickBookingDrawer";

export default function AdminShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="admin-root flex min-h-screen bg-surface-soft text-ink">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
      <QuickBookingDrawer />
    </div>
  );
}
