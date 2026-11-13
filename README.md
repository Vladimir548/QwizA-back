# QwizA-back

Requires Node.js >=22.14.0. Run commands from the repository root.

Install dependencies with npm ci.

Copy .env.example to .env and apps/api/.env.example to apps/api/.env. Set a local database password and DATABASE_URL / TEST_DATABASE_URL in the copied files. Run npm run db:up, npm run db:migrate, then npm run dev. API: http://127.0.0.1:4000/api. Set WEB_ORIGIN to the frontend origin. Integration tests require a separate migrated test database.

The presentation helper in apps/api/test/fixtures is a frontend protocol snapshot for the compatibility test. Keep it aligned with QwizA-front.

Checks: npm run typecheck, npm run lint, npm test, npm run build.

Application: apps/api. Shared game contracts and logic: packages/minigames. Environment secrets, dependencies, build output, and local uploads are excluded from Git.

Registration and login use a unique, case-insensitive nickname and password. Apply migration `20261111150000_unique_nicknames` before starting this release. Existing accounts, sessions and history are preserved; duplicate legacy names receive a suffix, and legacy email logins remain supported.

To grant an existing local account administrator rights, run `node scripts/grant-admin.cjs PlayerNickname`. The command also accepts a legacy email login.

## Docker

See [DOCKER.md](DOCKER.md) for image build, run, migrations, and media storage commands.
