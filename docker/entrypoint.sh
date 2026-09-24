#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy
if [ "${SEED_ON_START:-1}" = "1" ]; then
  echo "[entrypoint] seed (idempotent)"
  # Сбой seed останавливает старт: от seed зависят тексты сообщений и выключенные правила.
  # Аварийный выход — SEED_STRICT=0 (стартовать без seed)
  if ! node node_modules/tsx/dist/cli.mjs prisma/seed.ts; then
    echo "[entrypoint] ОШИБКА: seed не прошёл — тексты сообщений и правила остались старыми"
    if [ "${SEED_STRICT:-1}" = "1" ]; then
      echo "[entrypoint] старт остановлен (SEED_STRICT=1); запустить без seed — SEED_STRICT=0"
      exit 1
    fi
    echo "[entrypoint] продолжаем без seed (SEED_STRICT=0)"
  fi
fi
exec node server.js
