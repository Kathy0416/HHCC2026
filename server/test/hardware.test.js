'use strict';

process.env.JWT_SECRET = 'hardware-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { signToken } = require('../middleware');
const { localeMiddleware } = require('../i18n');
const { createHardwareRouter } = require('../routes/hardware');
const {
  crc32, decodeEvent, EVENT_HEADER_BYTES, SAMPLE_RECORD_BYTES, EVENT_FOOTER_BYTES
} = require('../lib/binary_codec');

function schema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE hardware_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, device_id TEXT NOT NULL UNIQUE, device_token TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_seen_at TEXT);
    CREATE TABLE hardware_events (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, user_id INTEGER NOT NULL, event_id TEXT NOT NULL, event_sequence INTEGER, event_utc_ms INTEGER, boot_id INTEGER, time_quality INTEGER NOT NULL DEFAULT 0, status INTEGER NOT NULL DEFAULT 1, pre_count INTEGER NOT NULL DEFAULT 0, active_count INTEGER NOT NULL DEFAULT 0, sample_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(device_id, event_id));
    CREATE TABLE hardware_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL, sample_index INTEGER NOT NULL, monotonic_us INTEGER, utc_epoch_ms INTEGER, boot_id INTEGER, sampling_mode INTEGER NOT NULL DEFAULT 0, time_quality INTEGER NOT NULL DEFAULT 0, light_lux REAL, temperature_c REAL, humidity_percent REAL, noise_db_spl REAL, valid_mask INTEGER NOT NULL DEFAULT 0, UNIQUE(event_id, sample_index));
  `);
}

// 构造一个与固件 binary_codec v1 完全一致的合法事件文件。
function buildEvent({ eventId = 'EVT-0001', deviceId = '0123456789AB', preCount = 3, activeCount = 2, eventUtcMs = 1755000000000 }) {
  const sampleCount = preCount + activeCount;
  const total = EVENT_HEADER_BYTES + sampleCount * SAMPLE_RECORD_BYTES + EVENT_FOOTER_BYTES;
  const buf = Buffer.alloc(total);

  buf.write('MGEV', 0, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(EVENT_HEADER_BYTES, 6);
  buf.write(eventId, 8, 64, 'utf8');
  buf.write(deviceId, 72, 13, 'utf8');
  buf[85] = 1;
  buf[86] = 1;
  buf.writeUInt32LE(0x12345678, 88);
  buf.writeBigUInt64LE(1n, 92);
  buf.writeBigUInt64LE(1000000n, 100);
  buf.writeBigInt64LE(BigInt(eventUtcMs), 108);
  buf.writeUInt32LE(3600000, 116);
  buf.writeUInt32LE(600000, 120);
  buf.writeUInt32LE(5000, 124);
  buf.writeUInt32LE(1000, 128);
  buf.writeUInt16LE(preCount, 132);
  buf.writeUInt16LE(activeCount, 134);
  buf.writeUInt16LE(preCount, 136);
  buf.writeUInt16LE(0x000F, 138);
  buf.writeUInt32LE(0xDEADBEEF, 140);
  buf.writeUInt16LE(SAMPLE_RECORD_BYTES, 144);
  buf.writeUInt32LE(crc32(buf.subarray(0, 156)), 156);

  for (let i = 0; i < sampleCount; i += 1) {
    const off = EVENT_HEADER_BYTES + i * SAMPLE_RECORD_BYTES;
    buf.writeBigUInt64LE(BigInt(1000000 + i * 1000), off);
    buf.writeBigInt64LE(BigInt(eventUtcMs + i * 1000), off + 8);
    buf.writeUInt32LE(0x12345678, off + 16);
    buf.writeFloatLE(100 + i, off + 20);
    buf.writeFloatLE(25.5, off + 24);
    buf.writeFloatLE(50, off + 28);
    buf.writeFloatLE(40.0, off + 32);
    buf[off + 36] = i < preCount ? 1 : 2;
    buf[off + 37] = 1;
    buf[off + 38] = 0x0F;
    buf.writeUInt32LE(crc32(buf.subarray(off, off + 40)), off + 40);
  }

  const foff = EVENT_HEADER_BYTES + sampleCount * SAMPLE_RECORD_BYTES;
  buf.write('MEND', foff, 'ascii');
  buf.writeUInt16LE(1, foff + 4);
  buf[foff + 6] = 1;
  buf[foff + 7] = 0;
  buf.writeUInt32LE(preCount, foff + 8);
  buf.writeUInt32LE(activeCount, foff + 12);
  buf.writeUInt32LE(sampleCount, foff + 16);
  buf.writeUInt32LE(0, foff + 20);
  buf.writeBigUInt64LE(0n, foff + 24);
  buf.writeBigInt64LE(0n, foff + 32);
  buf.writeUInt32LE(crc32(buf.subarray(foff, foff + 60)), foff + 60);

  return buf;
}

test('binary codec decodes a valid event and rejects CRC corruption', () => {
  const event = buildEvent({ preCount: 3, activeCount: 2 });
  const decoded = decodeEvent(event);
  assert.equal(decoded.header.eventId, 'EVT-0001');
  assert.equal(decoded.header.deviceId, '0123456789AB');
  assert.equal(decoded.samples.length, 5);
  assert.equal(decoded.footer.preCount, 3);
  assert.equal(decoded.samples[0].lightLux, 100);
  assert.equal(decoded.samples[0].mode, 1);

  const corrupted = Buffer.from(event);
  corrupted[EVENT_HEADER_BYTES + 20] ^= 0xFF; // 破坏第一条样本
  assert.throws(() => decodeEvent(corrupted), /CRC mismatch/);
});

test('device registration + binary upload are idempotent and user-isolated', async (t) => {
  const db = new DatabaseSync(':memory:');
  schema(db);
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(1, 'one', 'x');
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(2, 'two', 'x');

  const app = express();
  app.use(express.json());
  app.use(localeMiddleware);
  app.use('/api/hardware', createHardwareRouter(db));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  t.after(() => db.close());

  const base = `http://127.0.0.1:${server.address().port}/api/hardware`;
  const userToken = signToken({ id: 1, username: 'one' });

  const regRes = await fetch(`${base}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ deviceId: '0123456789AB', name: 'Desk monitor' })
  });
  assert.equal(regRes.status, 201);
  const { token: deviceToken } = await regRes.json();

  const eventBody = buildEvent({ eventId: 'EVT-0001', deviceId: '0123456789AB', preCount: 3, activeCount: 2 });
  const upload = () => fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${deviceToken}` },
    body: eventBody
  });

  const res1 = await upload();
  assert.equal(res1.status, 201);
  const data1 = await res1.json();
  assert.equal(data1.ok, true);
  assert.equal(data1.samplesStored, 5);

  const res2 = await upload();
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.duplicate, true);

  const noAuth = await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: eventBody
  });
  assert.equal(noAuth.status, 401);

  const listRes = await fetch(`${base}/events`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.equal(list.events.length, 1);
  assert.equal(list.events[0].sampleCount, 5);

  const otherToken = signToken({ id: 2, username: 'two' });
  const otherRes = await fetch(`${base}/events`, {
    headers: { Authorization: `Bearer ${otherToken}` }
  });
  const other = await otherRes.json();
  assert.equal(other.events.length, 0);

  const samplesRes = await fetch(`${base}/events/${list.events[0].id}/samples`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  const samplesData = await samplesRes.json();
  assert.equal(samplesData.samples.length, 5);
  assert.equal(samplesData.samples[0].light_lux, 100);
});
