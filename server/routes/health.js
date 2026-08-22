'use strict';

const express = require('express');
const { requireAuth } = require('../middleware');
const defaultDb = require('../db');
const {
  DATE_RE, ENVIRONMENT_SESSION_LIMIT, buildAnalysis, buildEnvironmentSeries, parseRange, safeJson, todayInZone
} = require('../health-analysis');

const MAX_DAYS_PER_SYNC = 100;
const MAX_SESSIONS_PER_SYNC = 300;
const MAX_ENVIRONMENT_READINGS_PER_SYNC = 500;
const DEVICE_TYPES = new Set(['apple', 'miband']);

function text(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function optionalNumber(value, min, max, integer = false) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new TypeError('invalidMetric');
  }
  return number;
}

function metric(value, min, max) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    min: optionalNumber(input.min, min, max),
    avg: optionalNumber(input.avg, min, max),
    max: optionalNumber(input.max, min, max),
    count: optionalNumber(input.count, 0, 1000000, true) || 0
  };
}

function validTimezone(value) {
  const timezone = text(value || 'UTC', 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch (error) {
    throw new TypeError('invalidTimezone');
  }
}

function validIso(value, required = false) {
  if (value == null || value === '') {
    if (required) throw new TypeError('invalidTimestamp');
    return null;
  }
  const result = text(value, 40);
  if (!Number.isFinite(Date.parse(result))) throw new TypeError('invalidTimestamp');
  return result;
}

function localDateForTimestamp(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function requiredNumber(value, min, max, integer = false) {
  const result = optionalNumber(value, min, max, integer);
  if (result == null) throw new TypeError('invalidMetric');
  return result;
}

function stringArray(value, limit = 20) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) throw new TypeError('invalidHealthPayload');
  return [...new Set(value.map((item) => text(item, 200)).filter(Boolean))];
}

function cleanStages(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalidHealthPayload');
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = text(key, 40);
    if (!name) continue;
    result[name] = optionalNumber(raw, 0, 1440, true);
  }
  return result;
}

function cleanDay(value, defaultTimezone) {
  if (!value || typeof value !== 'object' || !DATE_RE.test(String(value.date || ''))) {
    throw new TypeError('invalidDate');
  }
  const sleep = value.sleep && typeof value.sleep === 'object' ? value.sleep : {};
  const heartRate = metric(value.heartRate, 1, 300);
  const spo2 = metric(value.spo2, 0, 100);
  return {
    date: value.date,
    timezone: validTimezone(value.timezone || defaultTimezone),
    sleepStart: validIso(sleep.start),
    sleepEnd: validIso(sleep.end),
    sleepDuration: optionalNumber(sleep.durationMinutes, 0, 1440, true),
    sleepStages: cleanStages(sleep.stages),
    heartRate,
    spo2,
    steps: optionalNumber(value.steps, 0, 500000, true),
    dataOrigins: stringArray(value.dataOrigins)
  };
}

function cleanSession(value) {
  if (!value || typeof value !== 'object' || !DATE_RE.test(String(value.localDate || ''))) {
    throw new TypeError('invalidDate');
  }
  const sourceRecordId = text(value.sourceRecordId, 240);
  if (!sourceRecordId) throw new TypeError('invalidHealthPayload');
  return {
    sourceRecordId,
    localDate: value.localDate,
    start: validIso(value.start, true),
    end: validIso(value.end, true),
    durationMinutes: optionalNumber(value.durationMinutes, 0, 1440, true),
    stages: cleanStages(value.stages),
    dataOrigin: text(value.dataOrigin, 200)
  };
}

function cleanEnvironmentReading(value, timezone) {
  if (!value || typeof value !== 'object') throw new TypeError('invalidHealthPayload');
  const sourceRecordId = text(value.sourceRecordId, 240);
  if (!sourceRecordId) throw new TypeError('invalidHealthPayload');
  const recordedAt = new Date(validIso(value.recordedAt, true)).toISOString();
  return {
    sourceRecordId,
    recordedAt,
    localDate: localDateForTimestamp(recordedAt, timezone),
    timezone,
    monoUs: requiredNumber(value.monoUs, 0, Number.MAX_SAFE_INTEGER, true),
    mode: text(value.mode, 40),
    temperatureC: requiredNumber(value.temperatureC, -50, 100),
    humidityPct: requiredNumber(value.humidityPct, 0, 100),
    lightLux: requiredNumber(value.lightLux, 0, 1000000),
    noiseDb: requiredNumber(value.noiseDb, 0, 200)
  };
}

function connectionJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    deviceName: row.device_name,
    manufacturer: row.manufacturer,
    model: row.model,
    sourcePackages: safeJson(row.source_packages, []),
    active: !!row.active,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function devicePreferenceJson(row) {
  if (!row) return null;
  return {
    deviceType: row.device_type,
    displayName: row.display_name,
    updatedAt: row.updated_at
  };
}

function latestJson(row) {
  if (!row) return null;
  return {
    date: row.local_date,
    timezone: row.timezone,
    sleep: row.sleep_duration_minutes == null ? null : {
      start: row.sleep_start,
      end: row.sleep_end,
      durationMinutes: row.sleep_duration_minutes,
      stages: safeJson(row.sleep_stages, {})
    },
    heartRate: row.heart_rate_avg == null ? null : {
      min: row.heart_rate_min, avg: row.heart_rate_avg, max: row.heart_rate_max, count: row.heart_rate_count
    },
    spo2: row.spo2_avg == null ? null : {
      min: row.spo2_min, avg: row.spo2_avg, max: row.spo2_max, count: row.spo2_count
    },
    steps: row.steps,
    dataOrigins: safeJson(row.data_origins, [])
  };
}

function environmentLatestJson(row) {
  if (!row) return null;
  return {
    sourceRecordId: row.source_record_id,
    recordedAt: row.recorded_at,
    mode: row.mode,
    temperatureC: row.temperature_c,
    humidityPct: row.humidity_pct,
    lightLux: row.light_lux,
    noiseDb: row.noise_db
  };
}

function createHealthRouter(db = defaultDb) {
  const router = express.Router();
  router.use(requireAuth);

  router.post('/connections', (req, res) => {
    const provider = text(req.body.provider || 'health_connect', 40);
    if (provider !== 'health_connect') return res.status(400).json({ error: req.t('invalidProvider') });

    let sourcePackages;
    try {
      sourcePackages = stringArray(req.body.sourcePackages);
    } catch (error) {
      return res.status(400).json({ error: req.t('invalidHealthPayload') });
    }

    db.prepare(`
      INSERT INTO health_connections (user_id, provider, device_name, manufacturer, model, source_packages, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id, provider) DO UPDATE SET
        device_name = excluded.device_name,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        source_packages = excluded.source_packages,
        active = 1,
        updated_at = datetime('now')
    `).run(
      req.user.id,
      provider,
      text(req.body.deviceName),
      text(req.body.manufacturer),
      text(req.body.model),
      JSON.stringify(sourcePackages)
    );

    const row = db.prepare('SELECT * FROM health_connections WHERE user_id = ? AND provider = ?').get(req.user.id, provider);
    res.status(201).json({ connection: connectionJson(row) });
  });

  router.get('/connection', (req, res) => {
    const row = db.prepare(`
      SELECT * FROM health_connections WHERE user_id = ? ORDER BY active DESC, updated_at DESC, id DESC LIMIT 1
    `).get(req.user.id);
    const latest = row ? db.prepare(`
      SELECT * FROM health_daily WHERE user_id = ? AND connection_id = ? ORDER BY local_date DESC LIMIT 1
    `).get(req.user.id, row.id) : null;
    const environmentLatest = row ? db.prepare(`
      SELECT * FROM environment_readings WHERE user_id = ? AND connection_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
    `).get(req.user.id, row.id) : null;
    const devicePreference = db.prepare('SELECT * FROM health_device_preferences WHERE user_id = ?').get(req.user.id);
    res.json({
      connection: connectionJson(row),
      latest: latestJson(latest),
      environmentLatest: environmentLatestJson(environmentLatest),
      devicePreference: devicePreferenceJson(devicePreference)
    });
  });

  router.put('/device-preference', (req, res) => {
    const deviceType = text(req.body.deviceType, 20).toLowerCase();
    const displayName = String(req.body.displayName == null ? '' : req.body.displayName).trim();
    if (!DEVICE_TYPES.has(deviceType)) return res.status(400).json({ error: req.t('invalidDeviceType') });
    if (!displayName || Array.from(displayName).length > 60) {
      return res.status(400).json({ error: req.t('invalidDeviceName') });
    }

    db.prepare(`
      INSERT INTO health_device_preferences (user_id, device_type, display_name, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        device_type = excluded.device_type,
        display_name = excluded.display_name,
        updated_at = datetime('now')
    `).run(req.user.id, deviceType, displayName);
    const row = db.prepare('SELECT * FROM health_device_preferences WHERE user_id = ?').get(req.user.id);
    res.json({ devicePreference: devicePreferenceJson(row) });
  });

  router.delete('/connections/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: req.t('invalidConnection') });
    const result = db.prepare(`
      UPDATE health_connections SET active = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: req.t('connectionNotFound') });
    res.json({ ok: true, retainedHistory: true });
  });

  router.post('/sync', (req, res, next) => {
    const connectionId = Number(req.body.connectionId);
    if (!Number.isInteger(connectionId) || connectionId < 1) {
      return res.status(400).json({ error: req.t('invalidConnection') });
    }
    const connection = db.prepare(`
      SELECT * FROM health_connections WHERE id = ? AND user_id = ?
    `).get(connectionId, req.user.id);
    if (!connection) return res.status(404).json({ error: req.t('connectionNotFound') });
    if (!connection.active) return res.status(409).json({ error: req.t('connectionInactive') });

    const inputDays = req.body.days == null ? [] : req.body.days;
    const inputSessions = req.body.sleepSessions == null ? [] : req.body.sleepSessions;
    if (!Array.isArray(inputDays) || inputDays.length > MAX_DAYS_PER_SYNC ||
        !Array.isArray(inputSessions) || inputSessions.length > MAX_SESSIONS_PER_SYNC) {
      return res.status(400).json({ error: req.t('invalidHealthPayload') });
    }

    let days;
    let sessions;
    try {
      const timezone = validTimezone(req.body.timezone || 'UTC');
      days = inputDays.map((day) => cleanDay(day, timezone));
      sessions = inputSessions.map(cleanSession);
    } catch (error) {
      const key = ['invalidDate', 'invalidTimezone', 'invalidTimestamp'].includes(error.message)
        ? error.message
        : 'invalidHealthPayload';
      return res.status(400).json({ error: req.t(key) });
    }

    const upsertDay = db.prepare(`
      INSERT INTO health_daily (
        connection_id, user_id, local_date, timezone, sleep_start, sleep_end, sleep_duration_minutes, sleep_stages,
        heart_rate_min, heart_rate_avg, heart_rate_max, heart_rate_count,
        spo2_min, spo2_avg, spo2_max, spo2_count, steps, data_origins, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(connection_id, local_date) DO UPDATE SET
        timezone = excluded.timezone,
        sleep_start = excluded.sleep_start,
        sleep_end = excluded.sleep_end,
        sleep_duration_minutes = excluded.sleep_duration_minutes,
        sleep_stages = excluded.sleep_stages,
        heart_rate_min = excluded.heart_rate_min,
        heart_rate_avg = excluded.heart_rate_avg,
        heart_rate_max = excluded.heart_rate_max,
        heart_rate_count = excluded.heart_rate_count,
        spo2_min = excluded.spo2_min,
        spo2_avg = excluded.spo2_avg,
        spo2_max = excluded.spo2_max,
        spo2_count = excluded.spo2_count,
        steps = excluded.steps,
        data_origins = excluded.data_origins,
        updated_at = datetime('now')
    `);
    const upsertSession = db.prepare(`
      INSERT INTO health_sleep_sessions (
        connection_id, user_id, source_record_id, local_date, start_time, end_time, duration_minutes, stages, data_origin, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(connection_id, source_record_id) DO UPDATE SET
        local_date = excluded.local_date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        duration_minutes = excluded.duration_minutes,
        stages = excluded.stages,
        data_origin = excluded.data_origin,
        updated_at = datetime('now')
    `);

    try {
      db.exec('BEGIN IMMEDIATE');
      for (const day of days) {
        upsertDay.run(
          connection.id, req.user.id, day.date, day.timezone,
          day.sleepStart, day.sleepEnd, day.sleepDuration, JSON.stringify(day.sleepStages),
          day.heartRate.min, day.heartRate.avg, day.heartRate.max, day.heartRate.count,
          day.spo2.min, day.spo2.avg, day.spo2.max, day.spo2.count,
          day.steps, JSON.stringify(day.dataOrigins)
        );
      }
      for (const session of sessions) {
        upsertSession.run(
          connection.id, req.user.id, session.sourceRecordId, session.localDate,
          session.start, session.end, session.durationMinutes, JSON.stringify(session.stages), session.dataOrigin
        );
      }
      db.prepare(`
        UPDATE health_connections SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?
      `).run(connection.id, req.user.id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { /* transaction was not active */ }
      return next(error);
    }
    res.json({ ok: true, daysUpserted: days.length, sleepSessionsUpserted: sessions.length });
  });

  router.post('/environment-sync', (req, res, next) => {
    const connectionId = Number(req.body.connectionId);
    if (!Number.isInteger(connectionId) || connectionId < 1) {
      return res.status(400).json({ error: req.t('invalidConnection') });
    }
    const connection = db.prepare(`
      SELECT * FROM health_connections WHERE id = ? AND user_id = ?
    `).get(connectionId, req.user.id);
    if (!connection) return res.status(404).json({ error: req.t('connectionNotFound') });
    if (!connection.active) return res.status(409).json({ error: req.t('connectionInactive') });

    const input = req.body.readings;
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_ENVIRONMENT_READINGS_PER_SYNC) {
      return res.status(400).json({ error: req.t('invalidHealthPayload') });
    }

    let readings;
    try {
      const timezone = validTimezone(req.body.timezone || 'UTC');
      readings = input.map((reading) => cleanEnvironmentReading(reading, timezone));
    } catch (error) {
      const key = ['invalidTimezone', 'invalidTimestamp'].includes(error.message)
        ? error.message
        : 'invalidHealthPayload';
      return res.status(400).json({ error: req.t(key) });
    }

    const upsert = db.prepare(`
      INSERT INTO environment_readings (
        connection_id, user_id, source_record_id, recorded_at, local_date, timezone, mono_us, mode,
        temperature_c, humidity_pct, light_lux, noise_db, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(connection_id, source_record_id) DO UPDATE SET
        recorded_at = excluded.recorded_at,
        local_date = excluded.local_date,
        timezone = excluded.timezone,
        mono_us = excluded.mono_us,
        mode = excluded.mode,
        temperature_c = excluded.temperature_c,
        humidity_pct = excluded.humidity_pct,
        light_lux = excluded.light_lux,
        noise_db = excluded.noise_db,
        updated_at = datetime('now')
    `);

    try {
      db.exec('BEGIN IMMEDIATE');
      for (const reading of readings) {
        upsert.run(
          connection.id, req.user.id, reading.sourceRecordId, reading.recordedAt, reading.localDate,
          reading.timezone, reading.monoUs, reading.mode, reading.temperatureC, reading.humidityPct,
          reading.lightLux, reading.noiseDb
        );
      }
      db.prepare(`
        UPDATE health_connections SET last_synced_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND user_id = ?
      `).run(connection.id, req.user.id);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { /* transaction was not active */ }
      return next(error);
    }

    const latest = db.prepare(`
      SELECT * FROM environment_readings WHERE user_id = ? AND connection_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
    `).get(req.user.id, connection.id);
    res.json({ ok: true, readingsUpserted: readings.length, environmentLatest: environmentLatestJson(latest) });
  });

  router.get('/environment-series', (req, res) => {
    const rows = db.prepare(`
      SELECT id, recorded_at, temperature_c, humidity_pct, light_lux, noise_db
      FROM environment_readings
      WHERE user_id = ?
      ORDER BY recorded_at DESC, id DESC
      LIMIT ?
    `).all(req.user.id, ENVIRONMENT_SESSION_LIMIT + 1);
    res.json(buildEnvironmentSeries(rows));
  });

  router.get('/analysis', (req, res) => {
    const range = parseRange(req.query.range);
    if (!range) return res.status(400).json({ error: req.t('invalidRange') });
    const connection = db.prepare(`
      SELECT * FROM health_connections WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(req.user.id);
    const latest = db.prepare(`
      SELECT * FROM health_daily WHERE user_id = ? ORDER BY local_date DESC LIMIT 1
    `).get(req.user.id);
    const latestEnvironment = db.prepare(`
      SELECT timezone FROM environment_readings WHERE user_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
    `).get(req.user.id);
    const endDate = todayInZone((latest && latest.timezone) || (latestEnvironment && latestEnvironment.timezone));
    const startDate = new Date(`${endDate}T12:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - range + 1);
    const start = startDate.toISOString().slice(0, 10);

    const wearableRows = db.prepare(`
      SELECT * FROM health_daily WHERE user_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date ASC
    `).all(req.user.id, start, endDate);
    const manualRows = db.prepare(`
      SELECT * FROM sleep_records WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC
    `).all(req.user.id, start, endDate);
    const calendarRows = db.prepare(`
      SELECT * FROM calendar_entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC
    `).all(req.user.id, start, endDate);
    const environmentRows = db.prepare(`
      SELECT local_date,
        AVG(temperature_c) AS temperature_avg,
        AVG(humidity_pct) AS humidity_avg,
        AVG(light_lux) AS light_avg,
        AVG(noise_db) AS noise_avg
      FROM environment_readings
      WHERE user_id = ? AND local_date BETWEEN ? AND ?
      GROUP BY local_date
      ORDER BY local_date ASC
    `).all(req.user.id, start, endDate);
    const analysis = buildAnalysis({ range, endDate, wearableRows, manualRows, calendarRows, environmentRows });
    res.json({ connection: connectionJson(connection), latest: latestJson(latest), ...analysis });
  });

  return router;
}

const router = createHealthRouter();
module.exports = router;
module.exports.createHealthRouter = createHealthRouter;
module.exports._validation = { cleanDay, cleanSession, cleanEnvironmentReading, validTimezone };
