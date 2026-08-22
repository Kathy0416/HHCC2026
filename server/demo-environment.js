'use strict';

const DEMO_MODE = 'DEMO';
const DEMO_SOURCE_PREFIX = 'demo:environment:v1:';
const DEMO_SAMPLE_COUNT = 721;
const DEMO_INTERVAL_MS = 1000;
const DEMO_TIMEZONE = 'Asia/Shanghai';

function round(value) {
  return Number(value.toFixed(3));
}

function gaussian(value, center, width) {
  return Math.exp(-0.5 * ((value - center) / width) ** 2);
}

function localDateInZone(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function generateDemoEnvironmentReadings(endMs = Date.now(), timezone = DEMO_TIMEZONE) {
  const alignedEndMs = Math.floor(endMs / DEMO_INTERVAL_MS) * DEMO_INTERVAL_MS;
  const startMs = alignedEndMs - (DEMO_SAMPLE_COUNT - 1) * DEMO_INTERVAL_MS;

  return Array.from({ length: DEMO_SAMPLE_COUNT }, (_, index) => {
    const timestamp = startMs + index * DEMO_INTERVAL_MS;
    const minutes = index / 60;
    const activity = gaussian(minutes, 7.6, 1.05);
    const lightChange = gaussian(minutes, 6.8, 1.35);
    return {
      sourceRecordId: `${DEMO_SOURCE_PREFIX}${alignedEndMs}:${index}`,
      recordedAt: new Date(timestamp).toISOString(),
      localDate: localDateInZone(timestamp, timezone),
      timezone,
      monoUs: index * 1000000,
      mode: DEMO_MODE,
      temperatureC: round(23.7 + 0.035 * minutes + 0.58 * activity + 0.09 * Math.sin(index * 0.31) + 0.035 * Math.sin(index * 1.73)),
      humidityPct: round(61.8 - 0.1 * minutes - 1.9 * activity + 0.38 * Math.sin(index * 0.27 + 0.8) + 0.14 * Math.sin(index * 1.31)),
      lightLux: round(245 + 32 * Math.sin(minutes * 1.05) + 440 * lightChange + 24 * Math.sin(index * 0.42) + 9 * Math.sin(index * 1.57)),
      noiseDb: round(43.5 + 1.1 * Math.sin(minutes * 1.4) + 17.5 * gaussian(minutes, 7.8, 0.72) + 1.7 * Math.sin(index * 0.76) + 0.7 * Math.sin(index * 1.91))
    };
  });
}

function seedDemoEnvironment(db, username, options = {}) {
  const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!user) throw new Error(`User not found: ${username}`);

  const timezone = options.timezone || DEMO_TIMEZONE;
  const readings = generateDemoEnvironmentReadings(options.endMs, timezone);
  let connection = db.prepare(`
    SELECT * FROM health_connections WHERE user_id = ? AND provider = 'health_connect'
  `).get(user.id);

  try {
    db.exec('BEGIN IMMEDIATE');
    if (!connection) {
      const result = db.prepare(`
        INSERT INTO health_connections (
          user_id, provider, device_name, manufacturer, model, source_packages, active, last_synced_at
        ) VALUES (?, 'health_connect', ?, ?, ?, ?, 1, datetime('now'))
      `).run(user.id, 'Demo environment sensor', 'Migraine Signal', 'Synthetic session', '["demo.environment"]');
      connection = { id: Number(result.lastInsertRowid) };
    }

    // Re-seeding replaces only data created by this demo utility; genuine sensor rows are untouched.
    db.prepare(`
      DELETE FROM environment_readings
      WHERE user_id = ? AND source_record_id LIKE ?
    `).run(user.id, `${DEMO_SOURCE_PREFIX}%`);

    const insert = db.prepare(`
      INSERT INTO environment_readings (
        connection_id, user_id, source_record_id, recorded_at, local_date, timezone,
        mono_us, mode, temperature_c, humidity_pct, light_lux, noise_db
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const reading of readings) {
      insert.run(
        connection.id, user.id, reading.sourceRecordId, reading.recordedAt, reading.localDate,
        reading.timezone, reading.monoUs, reading.mode, reading.temperatureC,
        reading.humidityPct, reading.lightLux, reading.noiseDb
      );
    }
    db.prepare(`
      UPDATE health_connections
      SET last_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(connection.id, user.id);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) { /* transaction was not active */ }
    throw error;
  }

  return {
    username: user.username,
    sampleCount: readings.length,
    startAt: readings[0].recordedAt,
    endAt: readings.at(-1).recordedAt,
    timezone
  };
}

module.exports = {
  DEMO_MODE,
  DEMO_SOURCE_PREFIX,
  generateDemoEnvironmentReadings,
  seedDemoEnvironment
};
