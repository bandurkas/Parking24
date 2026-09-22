// Next зовёт register() один раз на процесс сервера, до первого запроса. Здесь только заводим таймер.
export async function register() {
  // Литерал, а не функция: иначе бандлер не выбросит ветку, и Prisma попадёт в Edge-сборку
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Ошибка из register() оставляет сервер отвечать 500 на всё — гасим её здесь
  try {
    const { bootScheduler } = await import("@/server/automations/scheduler");
    bootScheduler();
  } catch (e) {
    console.error("[scheduler] не запустился:", e);
  }
}
