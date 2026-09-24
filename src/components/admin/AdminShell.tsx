import type { SessionUser } from "@/server/auth/session";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import MobileNav from "./MobileNav";
import QuickBookingDrawer from "./QuickBookingDrawer";
import { unreadNoticeViews } from "@/server/services/notices";

export default async function AdminShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const notices = await unreadNoticeViews();
  return (
    <div className="admin-root flex min-h-screen bg-surface-soft text-ink">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} notices={notices} />
        <main className="min-w-0 flex-1 p-4 pb-24 lg:p-6 lg:pb-6">{children}</main>
      </div>
      <QuickBookingDrawer />
      <MobileNav user={user} />
    </div>
  );
}
