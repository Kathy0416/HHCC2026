'use strict';

process.env.JWT_SECRET = 'metrics-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { signToken } = require('../middleware');
const { localeMiddleware } = require('../i18n');
const { createMetricsRouter } = require('../routes/metrics');

function schema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE migraine_duration_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 0, last_updated TEXT, UNIQUE(user_id, date));
    CREATE TABLE spo2_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, spo2 REAL, last_updated TEXT, UNIQUE(user_id, date));
    CREATE TABLE heart_rate_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, bpm REAL, last_updated TEXT, UNIQUE(user_id, date));
    CREATE TABLE steps_records (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, date TEXT NOT NULL, steps INTEGER, last_updated TEXT, UNIQUE(user_id, date));
  `);
}

test('metrics CRUD is idempotent, validated, and user-isolated', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(2, 'two', 'x');

  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/metrics', createMetricsRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());

  const base = `http://127.0.0.1:${server.address().port}/api/metrics`;
  const tokenOne = signToken({ id: 1, username: 'one' });
  const tokenTwo = signToken({ id: 2, username: 'two' });
  const call = (path, options = {}, token = tokenOne) => fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });

  // 保存各指标（偏头痛时长 / 血氧 / 心跳 / 步数）
  let response = await call('/migraine-duration/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: 90 }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.value, 90);

  response = await call('/spo2/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: 97.6 }) });
  assert.equal((await response.json()).record.value, 97.6);

  response = await call('/heart-rate/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: 72 }) });
  assert.equal((await response.json()).record.value, 72);

  // 整数类型四舍五入
  response = await call('/steps/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: 8000.4 }) });
  assert.equal((await response.json()).record.value, 8000);

  // 幂等：再次保存同一日期，记录数不变
  await call('/steps/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: 9000 }) });
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM steps_records WHERE user_id = 1').get().c, 1);

  // 读取全部记录
  response = await call('/steps');
  let body = await response.json();
  assert.equal(body.records.length, 1);
  assert.equal(body.records[0].value, 9000);

  // 用户隔离
  response = await call('/steps', {}, tokenTwo);
  body = await response.json();
  assert.equal(body.records.length, 0);

  // 校验：非法日期
  response = await call('/steps/not-a-date', { method: 'PUT', body: JSON.stringify({ value: 1 }) });
  assert.equal(response.status, 400);

  // 校验：负值
  response = await call('/steps/2026-01-15', { method: 'PUT', body: JSON.stringify({ value: -5 }) });
  assert.equal(response.status, 400);

  // 删除
  response = await call('/steps/2026-01-15', { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM steps_records WHERE user_id = 1').get().c, 0);
});
