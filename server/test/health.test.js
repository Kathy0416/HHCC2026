'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'health-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { signToken } = require('../middleware');
const { localeMiddleware } = require('../i18n');
const { buildAnalysis, parseRange } = require('../health-analysis');
const { createHealthRouter } = require('../routes/health');

function schema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE calendar_entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, migraine INTEGER NOT NULL DEFAULT 0, diary TEXT NOT NULL DEFAULT '', triggers TEXT NOT NULL DEFAULT '[]', last_updated TEXT, UNIQUE(user_id, date));
    CREATE TABLE sleep_records (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, sleep_time TEXT NOT NULL DEFAULT '', wake_time TEXT NOT NULL DEFAULT '', duration_hours INTEGER NOT NULL DEFAULT 0, duration_minutes INTEGER NOT NULL DEFAULT 0, duration_total_minutes INTEGER NOT NULL DEFAULT 0, quality TEXT NOT NULL DEFAULT '', UNIQUE(user_id, date));
    CREATE TABLE health_connections (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT 'health_connect', device_name TEXT NOT NULL DEFAULT '', manufacturer TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', source_packages TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, last_synced_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, provider));
    CREATE TABLE health_device_preferences (user_id INTEGER PRIMARY KEY, device_type TEXT NOT NULL, display_name TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE health_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', sleep_start TEXT, sleep_end TEXT, sleep_duration_minutes INTEGER, sleep_stages TEXT NOT NULL DEFAULT '{}', heart_rate_min REAL, heart_rate_avg REAL, heart_rate_max REAL, heart_rate_count INTEGER NOT NULL DEFAULT 0, spo2_min REAL, spo2_avg REAL, spo2_max REAL, spo2_count INTEGER NOT NULL DEFAULT 0, steps INTEGER, data_origins TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(connection_id, local_date));
    CREATE TABLE health_sleep_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, source_record_id TEXT NOT NULL, local_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, duration_minutes INTEGER NOT NULL, stages TEXT NOT NULL DEFAULT '{}', data_origin TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(connection_id, source_record_id));
    CREATE TABLE environment_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, source_record_id TEXT NOT NULL, recorded_at TEXT NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', mono_us INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT '', temperature_c REAL NOT NULL, humidity_pct REAL NOT NULL, light_lux REAL NOT NULL, noise_db REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(connection_id, source_record_id));
  `);
}

function isoDate(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test('analysis prefers wearable sleep and enforces evidence thresholds', () => {
  const dates = Array.from({ length: 7 }, (_, index) => isoDate(index - 6));
  const analysis = buildAnalysis({
    range: 7,
    endDate: dates[6],
    wearableRows: dates.map((date, index) => ({ local_date: date, sleep_duration_minutes: 420 + index, heart_rate_avg: 60 + index, spo2_avg: 97, steps: 5000 + index, sleep_start: null, sleep_end: null })),
    manualRows: [{ date: dates[0], duration_total_minutes: 100, sleep_time: '01:00', wake_time: '02:40' }],
    calendarRows: dates.map((date, index) => ({ date, migraine: index < 2 ? 1 : 0, triggers: index === 0 ? '["stress"]' : '[]' })),
    environmentRows: [{ local_date: dates[0], temperature_avg: 24.8, humidity_avg: 62.5, light_avg: 447.05, noise_avg: 60.95 }]
  });
  assert.equal(analysis.series[0].sleepMinutes, 420);
  assert.equal(analysis.series[0].sleepSource, 'wearable');
  assert.equal(analysis.coverage.insightsAvailable, true);
  assert.equal(analysis.comparisons.stressTriggerRate, 50);
  assert.equal(analysis.series[0].temperatureAvg, 24.8);
  assert.equal(analysis.series[0].humidityAvg, 62.5);
  assert.equal(parseRange('8'), null);
});

test('authenticated health flow is isolated, idempotent, and retains history after disconnect', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(2, 'two', 'x');

  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/health', createHealthRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());
  const base = `http://127.0.0.1:${server.address().port}/api/health`;
  const tokenOne = signToken({ id: 1, username: 'one' });
  const tokenTwo = signToken({ id: 2, username: 'two' });
  const call = (path, options = {}, token = tokenOne) => fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });

  let response = await fetch(base + '/environment-sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
  });
  assert.equal(response.status, 401);

  response = await call('/connections', {
    method: 'POST', body: JSON.stringify({ provider: 'health_connect', deviceName: 'Xiaomi Band', manufacturer: 'Xiaomi', sourcePackages: ['com.mi.health'] })
  });
  assert.equal(response.status, 201);
  const connection = (await response.json()).connection;

  response = await fetch(base + '/device-preference', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceType: 'apple', displayName: 'My Watch' })
  });
  assert.equal(response.status, 401);
  response = await call('/device-preference', { method: 'PUT', body: JSON.stringify({ deviceType: 'future', displayName: 'Future Watch' }) });
  assert.equal(response.status, 400);
  response = await call('/device-preference', { method: 'PUT', body: JSON.stringify({ deviceType: 'apple', displayName: ' '.repeat(2) }) });
  assert.equal(response.status, 400);
  response = await call('/device-preference', { method: 'PUT', body: JSON.stringify({ deviceType: 'apple', displayName: 'x'.repeat(61) }) });
  assert.equal(response.status, 400);
  response = await call('/device-preference', { method: 'PUT', body: JSON.stringify({ deviceType: 'apple', displayName: '  My Watch  ' }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).devicePreference.deviceType, 'apple');
  response = await call('/connection');
  assert.deepEqual((await response.json()).devicePreference.displayName, 'My Watch');
  response = await call('/connection', {}, tokenTwo);
  assert.equal((await response.json()).devicePreference, null);

  response = await call('/connections', {
    method: 'POST', body: JSON.stringify({ provider: 'health_connect', deviceName: 'Android Phone', manufacturer: 'Google', sourcePackages: ['com.mi.health'] })
  });
  assert.equal(response.status, 201);
  response = await call('/connection');
  const connectionAfterMetadataRefresh = await response.json();
  assert.equal(connectionAfterMetadataRefresh.connection.deviceName, 'Android Phone');
  assert.equal(connectionAfterMetadataRefresh.devicePreference.displayName, 'My Watch');

  const days = Array.from({ length: 7 }, (_, index) => ({
    date: isoDate(index - 6), timezone: 'UTC',
    sleep: { start: `${isoDate(index - 7)}T23:00:00Z`, end: `${isoDate(index - 6)}T06:00:00Z`, durationMinutes: 420, stages: { deep: 90 } },
    heartRate: { min: 50, avg: 62 + index, max: 110, count: 50 },
    spo2: { min: 94, avg: 97, max: 99, count: 10 }, steps: 7000 + index, dataOrigins: ['com.mi.health']
  }));
  for (let index = 0; index < 7; index += 1) {
    db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, triggers) VALUES (?, ?, ?, ?)').run(1, days[index].date, index < 2 ? 1 : 0, index === 0 ? '["stress"]' : '[]');
  }
  const syncBody = { userId: 2, connectionId: connection.id, timezone: 'UTC', days, sleepSessions: [{ sourceRecordId: 'sleep-1', localDate: days[0].date, start: days[0].sleep.start, end: days[0].sleep.end, durationMinutes: 420, stages: { deep: 90 }, dataOrigin: 'com.mi.health' }] };
  response = await call('/sync', { method: 'POST', body: JSON.stringify(syncBody) });
  assert.equal(response.status, 200);
  response = await call('/sync', { method: 'POST', body: JSON.stringify(syncBody) });
  assert.equal(response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily WHERE user_id = 1').get().count, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily WHERE user_id = 2').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_sleep_sessions').get().count, 1);

  const environmentBody = {
    connectionId: connection.id,
    timezone: 'UTC',
    readings: [
      { sourceRecordId: 'esp32:1:106183660', recordedAt: `${days[0].date}T12:00:00.000Z`, monoUs: 106183660, mode: 'NORMAL', temperatureC: 24.8, humidityPct: 62.9, lightLux: 428.3, noiseDb: 61.0 },
      { sourceRecordId: 'esp32:2:111189660', recordedAt: `${days[0].date}T12:00:05.000Z`, monoUs: 111189660, mode: 'NORMAL', temperatureC: 24.8, humidityPct: 62.1, lightLux: 465.8, noiseDb: 60.9 }
    ]
  };
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify(environmentBody) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environmentLatest.lightLux, 465.8);
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify(environmentBody) });
  assert.equal(response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM environment_readings WHERE user_id = 1').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily WHERE user_id = 1').get().count, 7);

  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify(environmentBody) }, tokenTwo);
  assert.equal(response.status, 404);
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify({ ...environmentBody, readings: [{ ...environmentBody.readings[0], recordedAt: null }] }) });
  assert.equal(response.status, 400);
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify({
    ...environmentBody, readings: [{ ...environmentBody.readings[0], temperatureC: 101 }]
  }) });
  assert.equal(response.status, 400);
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify({
    ...environmentBody, readings: Array.from({ length: 501 }, () => environmentBody.readings[0])
  }) });
  assert.equal(response.status, 400);

  response = await call('/connection');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).environmentLatest.temperatureC, 24.8);

  response = await call('/analysis?range=7');
  assert.equal(response.status, 200);
  const environmentAnalysis = await response.json();
  const environmentDay = environmentAnalysis.series.find((day) => day.date === days[0].date);
  assert.equal(environmentDay.temperatureAvg, 24.8);
  assert.equal(environmentDay.humidityAvg, 62.5);
  assert.equal(environmentDay.lightAvg, 447.05);
  assert.equal(environmentDay.noiseAvg, 60.95);

  response = await call('/analysis?range=7');
  const analysis = await response.json();
  assert.equal(analysis.coverage.insightsAvailable, true);
  assert.equal(analysis.kpis.migraineDays, 2);

  response = await call(`/connections/${connection.id}`, { method: 'DELETE' }, tokenTwo);
  assert.equal(response.status, 404);
  response = await call(`/connections/${connection.id}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  response = await call('/sync', { method: 'POST', body: JSON.stringify(syncBody) });
  assert.equal(response.status, 409);
  response = await call('/environment-sync', { method: 'POST', body: JSON.stringify(environmentBody) });
  assert.equal(response.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM health_daily WHERE user_id = 1').get().count, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM environment_readings WHERE user_id = 1').get().count, 2);
});
