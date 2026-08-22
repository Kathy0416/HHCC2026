# ESP32 Migraine Data Collector

This firmware implements local-first acquisition and persistence for the
classic 4 MB ESP32 DevKit V1. Wi-Fi is used for setup and UTC synchronization;
the firmware does not yet contain BLE, authentication, database upload, or
machine-learning code.

## Important upgrade warning

The old firmware may have valuable data in `/migraine0.csv` and
`/migraine1.csv`. Before changing the Arduino **Partition Scheme**, run the old
firmware and send `D` in Serial Monitor to export those logs. A partition-table
change can make an existing LittleFS partition inaccessible.

The new firmware mounts LittleFS with formatting disabled. It detects the two
legacy files, reports them in `STATUS`, and exports them with `DUMP_LEGACY`.
It never automatically deletes them.

## Hardware

| Device | ESP32 pins |
|---|---|
| SSD1306, BH1750, SHT31 I2C | SDA 21, SCL 22 |
| INMP441 | BCLK 18, WS 19, SD 23, L/R to GND |
| Motor driver input | 15 |
| Button to GND | 4 (`INPUT_PULLUP`) |

Do not connect a bare vibration motor directly to GPIO 15. Use a module with a
transistor/driver and flyback protection.

## Build

Install Arduino CLI, then compile using the pinned profile:

```sh
arduino-cli compile --profile esp32_devkit app/esp32/MigraineLightMonitor
```

The profile targets Arduino-ESP32 3.3.11 and pins all direct sensor/display
libraries plus Adafruit BusIO 1.17.4, their shared transitive dependency. In
Arduino IDE, select **ESP32 Dev Module**, **4MB Flash**, and the
same partition layout previously used by the device. The default 4 MB layout
provides a `0x160000` filesystem partition.

## Wi-Fi setup

Wi-Fi provisioning is non-blocking: sensor acquisition and event persistence
continue while the device connects or serves the setup page.

1. On first boot, join the access point named `MigraineMonitor-XXXXXX` from a
   phone. If saved Wi-Fi cannot connect for 20 seconds, this access point also
   starts automatically.
2. Enter the setup password `migraine-setup`. Change
   `Config::WIFI_SETUP_PASSWORD` in `config.h` before flashing if a different
   setup password is required.
3. The captive page should open automatically. Otherwise browse to
   `http://192.168.4.1/`.
4. Submit a 2.4 GHz Wi-Fi SSID and password. Credentials are saved to ESP32
   Preferences only after the connection succeeds. They are never printed to
   Serial output.

The setup access point closes after a successful connection. The device keeps
the station connection active and retries it in the background if it drops.
Use `WIFI_PORTAL` to open the setup page while already connected, or
`WIFI_FORGET` to remove saved credentials and return to setup mode. Preferences
storage is protected only when the ESP32's flash-security features are enabled.

## Server upload

Completed events can be uploaded over Wi-Fi to the backend. The backend stores
each event's binary file and its samples, keyed by device.

1. On the backend, log in and register this device (use the **Device ID** shown
   on the setup page or in `STATUS`); the backend returns a **device token**.
2. Open the setup page (`http://192.168.4.1/`), enter the Wi-Fi network and the
   server fields:
   - **Server URL**: e.g. `http://192.168.1.20:3000`
   - **Device token**: the token from step 1
3. Submit. The device saves the server config and connects to Wi-Fi.

Once connected and configured, the uploader scans for completed events every
`UPLOAD_CHECK_INTERVAL_MS` (30 s) and uploads them one at a time. Only complete
(`.evt`) events are uploaded; `.part`/`.incomplete`/`.corrupt` files are left
in place. After the backend acknowledges storage, the local event file is
deleted (`deleteAfterServerConfirmation`). `STATUS` reports upload counters and
the last error.

## Runtime behavior

- `NORMAL`: one sample every 5 seconds into a fixed 720-entry RAM buffer.
- `BASELINE`: one persistent sample every 5 minutes, segmented every 288 rows.
- Button press: persist available history as `EVENT_PRE`, then record 600
  `EVENT_ACTIVE` slots at 1 Hz.
- A second press during recording is acknowledged and ignored.
- Each active record is flushed immediately. A reboot leaves a `.part` file;
  boot recovery promotes a valid completed file or preserves it as
  `.incomplete`.
- At critical usage, only the oldest baseline segments are removed. If 96 KiB
  cannot be reserved after baseline cleanup, a new event is refused. Pending
  events and legacy data are never selected for automatic deletion.
- A failed sensor produces a cleared validity bit and `null` in CSV output;
  other sensors continue.

After Wi-Fi connects, SNTP obtains UTC from `pool.ntp.org`,
`time.cloudflare.com`, or `time.nist.gov`. The clock is refreshed hourly and
after reconnection. If Wi-Fi later drops, the last trustworthy UTC anchor and
the monotonic clock keep timestamps running for the rest of that boot.

UTC remains nullable until NTP succeeds. `TIME <epoch_ms>` is retained as an
offline fallback; a later NTP update supersedes that manual anchor for future
samples. Monotonic time and `boot_id` are always stored, and no timestamp is
fabricated across a cold boot. A completed event's footer anchor is used during
CSV export to backfill missing same-boot timestamps without rewriting the event
file.

## Serial commands

| Command | Purpose |
|---|---|
| `HELP` | List commands |
| `STATUS` | Device state, clock, history, and flash usage |
| `TIME <epoch_ms>` | Set the UTC anchor for this boot |
| `WIFI_STATUS` | Show connection, setup portal, IP, RSSI, and NTP state |
| `WIFI_PORTAL` | Open the phone setup portal without forgetting credentials |
| `WIFI_FORGET` | Forget credentials and immediately enter setup mode |
| `LIST_EVENTS` | List complete, incomplete, and quarantined event files |
| `DUMP_EVENT <event_id>` | Validate records and render readable CSV |
| `DUMP_LEGACY` | Export preserved old CSV logs |
| `MOTOR` | Test the vibration motor |
| `SELFTEST` | Run RAM-buffer, binary-codec, CRC, and state-transition tests |

There is no production Serial delete command. The future BLE layer must call
`StorageManager::deleteAfterServerConfirmation(event_id)` only after an
authenticated backend has confirmed complete storage.

## Binary event format, version 1

All integers are little-endian. Floating-point fields are IEEE-754 `float32`.
C++ structs are never written directly.

### Header: 160 bytes

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | `MGEV` magic |
| 4 | 2 | format version |
| 6 | 2 | header length |
| 8 | 64 | null-padded event ID |
| 72 | 13 | null-padded device ID |
| 85 | 1 | event type (`USER_REPORTED_MIGRAINE` = 1) |
| 86 | 1 | initial time quality |
| 88 | 4 | boot ID |
| 92 | 8 | persistent event sequence |
| 100 | 8 | button monotonic microseconds |
| 108 | 8 | button UTC milliseconds; zero means null |
| 116 | 16 | configured pre/active durations and intervals |
| 132 | 6 | expected pre, expected active, actual pre counts |
| 138 | 2 | sensor schema mask |
| 140 | 4 | random nonce |
| 144 | 2 | sample record length |
| 156 | 4 | CRC32 of bytes 0–155 |

### Sample: 44 bytes

| Offset | Size | Field |
|---:|---:|---|
| 0 | 8 | monotonic microseconds |
| 8 | 8 | UTC milliseconds; zero means null |
| 16 | 4 | boot ID |
| 20 | 4 | light lux |
| 24 | 4 | temperature °C |
| 28 | 4 | humidity percent |
| 32 | 4 | noise dB SPL |
| 36 | 1 | sampling mode |
| 37 | 1 | time quality |
| 38 | 1 | sensor validity bitmask |
| 39 | 1 | reserved |
| 40 | 4 | CRC32 of bytes 0–39 |

Validity bits are light `0x01`, temperature `0x02`, humidity `0x04`, and noise
`0x08`. Raw finite values remain in the record even when a validity bit is
cleared, allowing later investigation.

### Footer: 64 bytes

The footer contains `MEND`, version/status, actual pre/active/total counts,
payload CRC32, final monotonic/UTC timestamps, an optional clock anchor, and a
CRC32 over the first 60 footer bytes. Payload CRC covers every complete encoded
sample record, including each sample's own CRC.

## Hardware acceptance checks

1. Run `SELFTEST` and require `SELF_TEST_RESULT=PASS`.
2. Let normal mode fill past 720 records and confirm `history_count=720`.
3. Trigger an event before and after the history is full; verify actual pre
   counts and chronological CSV output.
4. Power-cycle during active recording; confirm `LIST_EVENTS` reports an
   incomplete file and `DUMP_EVENT` emits its valid prefix.
5. Power-cycle after completion; confirm the `.evt` remains.
6. Disconnect each sensor separately; confirm its values become `null` while
   all other acquisition continues.
7. Fill baseline storage past warning thresholds; confirm baseline-first
   cleanup and that event files remain unchanged.
8. Run one production-duration event and verify approximately 720 pre-event
   records, 600 active records, and stable free heap.
9. Provision Wi-Fi from a phone, reboot, and confirm automatic reconnection and
   `ntp_state=synchronized` in `WIFI_STATUS`.
10. Record before NTP completes, allow the event to finish after synchronization,
    and confirm `DUMP_EVENT` renders same-boot missing times as `BACKFILLED`.
