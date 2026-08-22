# Migraine Signal Health Connect companion

This sideloadable Android MVP reads user-approved Health Connect records, reduces them to daily summaries on the phone, and uploads them to the authenticated Migraine Signal backend. It does not connect to a Xiaomi band over Bluetooth and does not upload raw samples.

## Requirements

- Android Studio with JDK 17
- Android SDK 36 and Build Tools 35.0.0 or newer
- Android 9/API 28 or newer with Google Play services
- Health Connect installed on Android 13 and older; Android 14+ includes it in system settings
- Mi Fitness configured to sync supported data into Health Connect
- The Migraine Signal Node server reachable from the phone

The project uses AGP 8.13.0, Kotlin 2.2.20, the included Gradle 8.14.3 wrapper, and stable Health Connect client 1.1.0.

Build the debug APK:

```powershell
.\gradlew.bat :app:assembleDebug
```

The APK is produced at `app/build/outputs/apk/debug/app-debug.apk`. Install it with Android Studio or:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## Connect and sync

1. Start the web/backend project and create or log into a Migraine Signal account.
2. On a physical phone, enter the computer's LAN URL, such as `http://192.168.1.20:3000`. The emulator can use `http://10.0.2.2:3000`.
3. Log in with the same account used on the webpage.
4. Grant the requested read permissions. Historical access is optional; without it, Health Connect normally limits older third-party data.
5. Tap **Find data sources** and select the Mi Fitness package reported by Health Connect. Xiaomi-like package names are sorted first, but no package name is hard-coded.
6. Tap **Sync now**, then use **Refresh** on `sleep.html`.

The app checks granted permissions on every sync. Missing signal permissions produce a partial sync instead of inventing values. Sleep is assigned to its wake date in the phone's local time zone. Stress is excluded because Health Connect has no standard wearable stress-score record; the web dashboard uses the existing diary stress trigger instead.

## MVP security and limits

- JWTs are encrypted with an Android Keystore AES-GCM key before storage.
- The selected server URL is stored as a non-sensitive preference.
- Cleartext HTTP is enabled so a sideloaded hackathon build can reach a LAN development server. Use HTTPS and disable cleartext traffic for any deployed build.
- Sync is foreground-only. Disconnecting on the web disables future uploads while retaining uploaded history; running Sync again explicitly reactivates the connection.
- Play Store declarations, background sync, direct Xiaomi Cloud access, and release signing are intentionally out of scope.
