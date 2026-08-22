# Migraine Signal

Migraine Signal is a browser-based migraine tracker backed by Node.js, Express, and SQLite. Docker Compose runs the frontend and API together at [http://localhost:3000](http://localhost:3000).

The Health Analysis page at `sleep.html` combines manual sleep records, migraine diary data, and daily Health Connect summaries. A sideloadable foreground-sync Android client and build instructions are available in [`android-companion`](android-companion/README.md).

## Run with Docker Compose

Requirements: Docker Desktop with Docker Compose.

From this `app` directory, start the application:

```bash
docker compose up --build -d
```

Open:

- Application: [http://localhost:3000](http://localhost:3000)
- Health check: [http://localhost:3000/api/health](http://localhost:3000/api/health)

Useful commands:

```bash
# Follow application logs
docker compose logs -f migraine-app

# Stop the application
docker compose down

# Rebuild after dependency or Dockerfile changes
docker compose up --build -d

# Restart without rebuilding
docker compose restart migraine-app
```

SQLite data is stored in the named Docker volume `migraine-data`, so it survives container restarts and `docker compose down`. To intentionally delete all local application data, run `docker compose down --volumes`.

## Optional configuration

Docker Compose loads `server/.env` and, when present, an app-level `.env` that overrides it. For local Node development, use `server/.env`.

```dotenv
JWT_SECRET=replace-with-a-long-random-local-secret
DEEPSEEK_API_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
```

Do not commit `.env`; it is ignored by Git and excluded from the Docker build context. When `DEEPSEEK_API_KEY` is empty, the AI endpoint returns a clear configuration error instead of silently presenting a mock answer. For local Node development, copy `server/.env.example` to `server/.env`, set `DEEPSEEK_API_KEY`, set `SERVE_FRONTEND=1`, and start the server from the `server` directory.

```powershell
cd server
Copy-Item .env.example .env
# Edit .env and set DEEPSEEK_API_KEY plus SERVE_FRONTEND=1
npm start
```

The assistant's editable English and Chinese description, safety rules, and response behavior live in `server/ai-prompts.js`. Personalization uses only the authenticated user's aggregated records from the latest 90 days; diary content is treated as untrusted data rather than instructions.

## Troubleshooting

- Use port `3000`, not `8080`. Confirm nothing else owns it with `docker ps` or `Get-NetTCPConnection -LocalPort 3000` in PowerShell.
- Check container state with `docker compose ps` and startup errors with `docker compose logs migraine-app`.
- If Docker Desktop was just started, wait until its engine is ready and run `docker compose up --build -d` again.
- If the browser shows an older cached version, hard-refresh the page or clear the site's service-worker cache.
- If the health check works but the UI does not load, verify `SERVE_FRONTEND=1` has not been overridden.

Backend endpoints and the non-Docker development workflow are documented in [`server/README.md`](server/README.md).
