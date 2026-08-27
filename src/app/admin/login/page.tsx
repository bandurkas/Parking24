import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import LoginForm from "./LoginForm";

export const metadata = { title: "Вход — Паркинг 24 CRM", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect(user.role === "GUARD" ? "/admin/today" : "/admin");
  const { next } = await searchParams;
  return (
    <main className="admin-root relative flex min-h-screen items-center justify-center overflow-hidden bg-navy-deep px-4">
      <div aria-hidden className="board-grid pointer-events-none absolute inset-0 opacity-[0.07]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3 text-white">
          <span className="grid size-10 place-items-center rounded-lg bg-primary font-mono text-lg font-bold text-navy-deep">24</span>
          <div>
            <div className="text-lg font-bold leading-tight">Паркинг 24 · Питстоп</div>
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-steel">Диспетчерская</div>
          </div>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
