# Migraine Signal

Migraine Signal is a migraine tracker backed by Node.js, Express, and SQLite. It runs as a browser/PWA site and as a sideloadable Capacitor Android app (`com.migrainesignal.app`). Docker Compose serves the browser frontend and API together at [http://localhost:3000](http://localhost:3000).

The Health Analysis page at `sleep.html` combines manual sleep records, migraine diary data, and daily Health Connect summaries. In the Android app, the same page can request read-only Health Connect access and explicitly sync Mi Fitness-origin daily aggregates to the authenticated backend.

## Build the Android app

Requirements:

- Node.js 22 or newer
- JDK 21
- Android SDK with API 36 and platform tools
- Android 9/API 28 or newer on the target device

On Windows, the build wrapper automatically finds a full Microsoft or Android Studio JDK 21 installation when `JAVA_HOME` is not already configured.

Choose the backend URL at build time. `10.0.2.2` reaches the development computer from the Android emulator; a physical phone needs an HTTPS deployment or an accessible LAN address.

```powershell
npm ci
$env:MIGRAINE_API_URL = 'http://10.0.2.2:3000'
npm run android:assets
npm run android:verify
```

The build wrapper also handles Windows workspaces whose path contains non-ASCII characters by compiling through a temporary, validated junction and removing that junction afterward.

The debug build permits mixed HTTP content so the secure Capacitor WebView can reach a local development API. Release builds keep mixed content and cleartext traffic disabled. The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install it with Android Studio or:

```powershell
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

For a release web bundle, set `MIGRAINE_RELEASE=1`; the build then rejects non-HTTPS backend URLs. Release signing and Play Store publication are intentionally outside this sideloadable MVP.

### Health Connect setup

1. In Mi Fitness, enable its supported third-party/Health Connect sharing.
2. Open **Health Analysis** in the Migraine Signal Android app and log into the existing account.
3. Expand **Set up Android sync**, grant the requested read-only permissions, and choose the Mi Fitness data origin. Historical access is optional; without it, imports are limited to the most recent 30 days.
4. Tap **Sync now**. Sync only runs as this explicit foreground action; the web **Refresh** button only reloads data already uploaded to the backend.

Missing signal permissions produce a partial sync and missing values are not invented. Sleep is assigned to its wake date in the Android device's local time zone. Health Connect has no standard wearable stress score, so stress analysis continues to use the diary's user-selected stress trigger. Disconnecting in Migraine Signal stops future uploads but preserves history; revoke Health Connect permissions separately in Android settings.

The Android login token is encrypted with an AES-GCM key held by Android Keystore. Only daily aggregates and sleep sessions are uploaded; raw wearable samples stay on the phone.

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
