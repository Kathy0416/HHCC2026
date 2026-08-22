'use strict';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'ai-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { signToken } = require('../middleware');
const { localeMiddleware } = require('../i18n');
const { createAiRouter, _internals } = require('../routes/ai');

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE calendar_entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, migraine INTEGER NOT NULL DEFAULT 0, diary TEXT NOT NULL DEFAULT '', triggers TEXT NOT NULL DEFAULT '[]', last_updated TEXT);
    CREATE TABLE sleep_records (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, date TEXT NOT NULL, sleep_time TEXT NOT NULL DEFAULT '', wake_time TEXT NOT NULL DEFAULT '', duration_hours INTEGER NOT NULL DEFAULT 0, duration_minutes INTEGER NOT NULL DEFAULT 0, duration_total_minutes INTEGER NOT NULL DEFAULT 0, quality TEXT NOT NULL DEFAULT '');
    CREATE TABLE health_daily (id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', sleep_start TEXT, sleep_end TEXT, sleep_duration_minutes INTEGER, sleep_stages TEXT NOT NULL DEFAULT '{}', heart_rate_min REAL, heart_rate_avg REAL, heart_rate_max REAL, heart_rate_count INTEGER NOT NULL DEFAULT 0, spo2_min REAL, spo2_avg REAL, spo2_max REAL, spo2_count INTEGER NOT NULL DEFAULT 0, steps INTEGER, data_origins TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE environment_readings (id INTEGER PRIMARY KEY, connection_id INTEGER NOT NULL, user_id INTEGER NOT NULL, source_record_id TEXT NOT NULL, recorded_at TEXT NOT NULL, local_date TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', mono_us INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT '', temperature_c REAL NOT NULL, humidity_pct REAL NOT NULL, light_lux REAL NOT NULL, noise_db REAL NOT NULL);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(2, 'two', 'x');
  return db;
}

function relativeDate(offset) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function startApp(t, db, options) {
  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/ai', createAiRouter(db, options));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());
  return `http://127.0.0.1:${server.address().port}/api/ai`;
}

function post(base, body, token, language = 'en') {
  return fetch(`${base}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': language,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

test('authenticated chat uses V4 once, includes isolated 90-day data, and returns metadata', async (t) => {
  const db = createDatabase();
  const recent = relativeDate(-2);
  const old = relativeDate(-100);
  db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers) VALUES (?, ?, ?, ?, ?)').run(1, recent, 1, 'my recent attack', '["stress"]');
  db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers) VALUES (?, ?, ?, ?, ?)').run(1, old, 1, 'too old', '[]');
  db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers) VALUES (?, ?, ?, ?, ?)').run(2, recent, 1, 'other user secret', '[]');
  db.prepare('INSERT INTO sleep_records (user_id, date, duration_total_minutes, quality) VALUES (?, ?, ?, ?)').run(1, recent, 420, 'good');
  db.prepare(`INSERT INTO health_daily (id, connection_id, user_id, local_date, timezone, sleep_duration_minutes, heart_rate_avg, heart_rate_count, spo2_avg, spo2_count, steps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, 1, 1, recent, 'UTC', 430, 64, 20, 97, 5, 7600);
  db.prepare(`INSERT INTO environment_readings (id, connection_id, user_id, source_record_id, recorded_at, local_date, timezone, mono_us, temperature_c, humidity_pct, light_lux, noise_db)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, 1, 1, 'env-1', `${recent}T12:00:00Z`, recent, 'UTC', 1, 24, 60, 400, 55);

  let deepSeekRequest;
  const fetchImpl = async (url, options) => {
    deepSeekRequest = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Your records show a recent entry.' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const base = await startApp(t, db, { apiKey: 'test-key', fetchImpl, timeoutMs: 1000 });
  const token = signToken({ id: 1, username: 'one' });
  const response = await post(base, { message: 'What do my records show?', history: [{ role: 'user', content: 'What do my records show?' }] }, token);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    reply: 'Your records show a recent entry.',
    provider: 'deepseek', personalized: true,
    usedDataCategories: ['migraine', 'sleep', 'wearable', 'environment']
  });
  assert.equal(deepSeekRequest.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(deepSeekRequest.body.model, 'deepseek-v4-flash');
  assert.deepEqual(deepSeekRequest.body.thinking, { type: 'disabled' });
  assert.equal(deepSeekRequest.body.messages.filter((item) => item.role === 'user' && item.content === 'What do my records show?').length, 1);
  const personalData = deepSeekRequest.body.messages.find((item) => item.role === 'system' && item.content.startsWith('<personal_data>')).content;
  assert.match(personalData, /my recent attack/);
  assert.doesNotMatch(personalData, /too old/);
  assert.doesNotMatch(personalData, /other user secret/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = 1').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE user_id = 2').get().count, 0);
});

test('guest chat receives model knowledge without personal context', async (t) => {
  const db = createDatabase();
  let messages;
  const fetchImpl = async (url, options) => {
    messages = JSON.parse(options.body).messages;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'General answer' } }] }), { status: 200 });
  };
  const base = await startApp(t, db, { apiKey: 'test-key', fetchImpl });
  const response = await post(base, { message: 'What is migraine?', history: [] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.personalized, false);
  assert.deepEqual(body.usedDataCategories, []);
  assert.equal(messages.some((item) => item.content.startsWith('<personal_data>')), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get().count, 0);
});

test('configuration, validation, localization, and upstream failures are explicit', async (t) => {
  const db = createDatabase();
  const base = await startApp(t, db, { apiKey: '' });
  let response = await post(base, { message: 'hello' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AI_NOT_CONFIGURED');
  response = await post(base, { message: 'x'.repeat(_internals.MAX_MESSAGE_LENGTH + 1) }, null, 'zh-CN');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'MESSAGE_TOO_LONG');
});

test('upstream details are not exposed and history is bounded', async (t) => {
  const db = createDatabase();
  const fetchImpl = async () => new Response('private upstream detail', { status: 401 });
  const base = await startApp(t, db, { apiKey: 'bad-key', fetchImpl });
  const response = await post(base, { message: 'hello', history: [] });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'AI_UPSTREAM_ERROR');
  assert.doesNotMatch(body.error, /private upstream detail/);

  const history = Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: String(index) }));
  assert.equal(_internals.sanitizeHistory(history, 'new').length, _internals.MAX_HISTORY_ITEMS);
});
