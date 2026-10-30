#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

touch .env.local
chmod 600 .env.local
if ! grep -q '^CYD_DEV_DB_PASSWORD=' .env.local; then
    password=$(openssl rand -hex 24)
    {
        printf '\n# Development accounts database (npm run db)\n'
        printf 'CYD_DEV_DB_PASSWORD=%s\n' "$password"
        printf 'DATABASE_URL=postgres://cyd_dev:%s@127.0.0.1:55432/cyd_accounts_dev\n' "$password"
    } >> .env.local
    echo "Made a password for the development database and saved it in web/.env.local."
fi

CYD_DEV_DB_PASSWORD=$(grep -m1 '^CYD_DEV_DB_PASSWORD=' .env.local | cut -d= -f2-) \
    docker compose -f dev-db.compose.yml up -d --wait
echo "The development database is running on 127.0.0.1:55432 (DATABASE_URL in web/.env.local)."
