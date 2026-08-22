'use strict';

process.env.JWT_SECRET = 'readings-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { signToken } = require('../middleware');
const { localeMiddleware } = require('../i18n');
const { createReadingsRouter } = require('../routes/readings');

function schema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE hardware_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT NOT NULL UNIQUE, device_token TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT);
    CREATE TABLE hardware_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, user_id INTEGER NOT NULL, event_id TEXT NOT NULL, event_sequence INTEGER, event_utc_ms INTEGER, boot_id INTEGER, time_quality INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 1, pre_count INTEGER NOT NULL DEFAULT 0, active_count INTEGER NOT NULL DEFAULT 0, sample_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(device_id, event_id));
    CREATE TABLE hardware_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, sample_index INTEGER NOT NULL, monotonic_us INTEGER, utc_epoch_ms INTEGER, boot_id INTEGER, sampling_mode INTEGER NOT NULL DEFAULT 0, time_quality INTEGER NOT NULL DEFAULT 0, light_lux REAL, temperature_c REAL, humidity_percent REAL, noise_db_spl REAL, valid_mask INTEGER NOT NULL DEFAULT 0, UNIQUE(event_id, sample_index));
    CREATE TABLE vitals_readings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'wearable', utc_epoch_ms INTEGER NOT NULL, heart_rate REAL, spo2 REAL, steps INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
}

test('readings: vitals are written and read per-timestamp, user-isolated', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(2, 'two', 'x');

  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/readings', createReadingsRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());

  const base = `http://127.0.0.1:${server.address().port}/api/readings`;
  const tokenOne = signToken({ id: 1, username: 'one' });
  const tokenTwo = signToken({ id: 2, username: 'two' });
  const call = (path, options = {}, token = tokenOne) => fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });

  let response = await call('/vitals', {
    method: 'POST',
    body: JSON.stringify([
      { utcEpochMs: 1755000000000, heartRate: 70, spo2: 97.5, steps: 8000, source: 'wearable' },
      { utcEpochMs: 1755003600000, heartRate: 75, spo2: 98, steps: 8200, source: 'wearable' }
    ])
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).inserted, 2);

  response = await call('/vitals');
  assert.equal((await response.json()).readings.length, 2);
  response = await call('/vitals', {}, tokenTwo);
  assert.equal((await response.json()).readings.length, 0);

  response = await call('/vitals?start=1755003600000');
  assert.equal((await response.json()).readings.length, 1);

  response = await call('/vitals', { method: 'POST', body: JSON.stringify({}) });
  assert.equal(response.status, 400);
});

test('readings: environment readings are joined from hardware samples', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO hardware_devices (id, user_id, device_id, device_token, name) VALUES (?, ?, ?, ?, ?)').run(10, 1, 'DEV-1', 'tok', 'desk');
  db.prepare('INSERT INTO hardware_events (id, device_id, user_id, event_id, event_utc_ms, sample_count) VALUES (?, ?, ?, ?, ?, ?)').run(20, 10, 1, 'EVT-1', 1755000000000, 1);
  db.prepare('INSERT INTO hardware_samples (event_id, sample_index, utc_epoch_ms, light_lux, temperature_c, humidity_percent) VALUES (?, ?, ?, ?, ?, ?)').run(20, 0, 1755000000000, 300, 23.5, 48);

  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/readings', createReadingsRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());

  const base = `http://127.0.0.1:${server.address().port}/api/readings`;
  const tokenOne = signToken({ id: 1, username: 'one' });
  const response = await fetch(base + '/environment', { headers: { Authorization: `Bearer ${tokenOne}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.readings.length, 1);
  assert.equal(body.readings[0].temperatureC, 23.5);
  assert.equal(body.readings[0].lightLux, 300);
  assert.equal(body.readings[0].deviceId, 'DEV-1');
});
