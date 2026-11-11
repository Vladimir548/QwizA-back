# Docker

Run commands from the repository root.

## Backend

Use an existing PostgreSQL instance. Copy `apps/api/.env.example` to a local environment file and configure `DATABASE_URL` and `WEB_ORIGIN`. When PostgreSQL runs on the Docker Desktop host, use `host.docker.internal` instead of `127.0.0.1` in the database URL.

```sh
docker build -f Dockerfile -t qwiza-back .
docker run --rm -p 4000:4000 --env-file apps/api/.env -e HOST=0.0.0.0 -v qwiza-media:/app/apps/api/.local-data qwiza-back
```

The named volume preserves uploaded media. `HOST=0.0.0.0` overrides the loopback address in the local example environment. Set `WEB_ORIGIN` to the frontend's browser origin, without a trailing slash.

Apply migrations explicitly with the build target (it includes the Prisma CLI):

```sh
docker build -f Dockerfile --target build -t qwiza-back-migrations .
docker run --rm --env-file apps/api/.env qwiza-back-migrations npm run db:deploy -w @qwiza/api
```

Images use multiple build stages and run the application as the unprivileged `node` user. Environment files, dependencies, generated Windows binaries, build output, and local uploads are excluded from the build context.

For camera and microphone transmission, set LIVEKIT_URL (the browser-accessible wss:// address), LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the backend environment. LIVEKIT_API_URL optionally specifies an internal HTTP endpoint for server-side participant removal. Credentials stay on the backend; short-lived tokens are scoped to the authenticated room and media role. External viewing links remain supported.
