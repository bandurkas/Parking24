#!/bin/sh
set -e
echo "[entrypoint] prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy
if [ "${SEED_ON_START:-1}" = "1" ]; then
  echo "[entrypoint] seed (idempotent)"
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts || echo "[entrypoint] seed failed (continuing)"
fi
exec node server.js
