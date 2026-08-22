# Migraine Signal

Migraine Signal is a browser-based migraine tracker backed by Node.js, Express, and SQLite. Docker Compose runs the frontend and API together at [http://localhost:3000](http://localhost:3000).

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

Docker Compose reads an optional `.env` file from this directory. For example:

```dotenv
JWT_SECRET=replace-with-a-long-random-local-secret
DEEPSEEK_API_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
```

Do not commit `.env`; it is ignored by Git and excluded from the Docker build context. When `DEEPSEEK_API_KEY` is empty, the existing local mock AI response is used.

## Troubleshooting

- Use port `3000`, not `8080`. Confirm nothing else owns it with `docker ps` or `Get-NetTCPConnection -LocalPort 3000` in PowerShell.
- Check container state with `docker compose ps` and startup errors with `docker compose logs migraine-app`.
- If Docker Desktop was just started, wait until its engine is ready and run `docker compose up --build -d` again.
- If the browser shows an older cached version, hard-refresh the page or clear the site's service-worker cache.
- If the health check works but the UI does not load, verify `SERVE_FRONTEND=1` has not been overridden.

Backend endpoints and the non-Docker development workflow are documented in [`server/README.md`](server/README.md).
