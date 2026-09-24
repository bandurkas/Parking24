import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "p24_sid";

// 1) Basic Auth для stage (если заданы обе переменные).
// 2) /admin/* без cookie сессии → /admin/login (полная валидация сессии — в layout/actions).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  // У крона свой секрет в X-Cron-Secret, у вебхуков — в адресе; Basic Auth stage им не выдаётся (Wazzup его не умеет)
  const cron = pathname === "/api/cron" || pathname.startsWith("/api/cron/");
  const webhook = pathname.startsWith("/api/webhooks/");
  if (user && pass && !cron && !webhook) {
    const header = req.headers.get("authorization") ?? "";
    let ok = false;
    if (header.startsWith("Basic ")) {
      const [u, p] = atob(header.slice(6)).split(":");
      ok = u === user && p === pass;
    }
    if (!ok) {
      return new NextResponse("Требуется авторизация", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Parking24 stage"' },
      });
    }
  }

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    if (!req.cookies.get(SESSION_COOKIE)?.value) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = pathname !== "/admin" ? `?next=${encodeURIComponent(pathname)}` : "";
      return NextResponse.redirect(url);
    }
  }
  if (pathname.startsWith("/api/admin") && !req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/admin")) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|photos|icons|brand).*)"],
};
