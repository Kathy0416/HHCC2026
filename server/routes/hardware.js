'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware');
const defaultDb = require('../db');
const { decodeEvent } = require('../lib/binary_codec');

const MAX_EVENT_BYTES = 2 * 1024 * 1024; // 2 MB，与 express.raw 的 limit 一致

function text(value, maxLength = 160) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function generateDeviceToken() {
  return crypto.randomBytes(24).toString('hex');
}

// 从 Authorization: Bearer <token> 提取设备令牌并还原设备。
function requireDevice(db) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'device token required' });
    const device = db.prepare('SELECT * FROM hardware_devices WHERE device_token = ?').get(token);
    if (!device) return res.status(401).json({ error: 'invalid device token' });
    req.device = device;
    next();
  };
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function eventJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    deviceId: row.device_id,
    eventSequence: row.event_sequence,
    eventUtcMs: row.event_utc_ms,
    bootId: row.boot_id,
    timeQuality: row.time_quality,
    status: row.status,
    preCount: row.pre_count,
    activeCount: row.active_count,
    sampleCount: row.sample_count,
    createdAt: row.created_at
  };
}

function createHardwareRouter(db = defaultDb) {
  const router = express.Router();

  // 创建/登记一个设备，返回 device_token（后续 ESP32 上传凭此令牌）。
  router.post('/devices', requireAuth, (req, res) => {
    const deviceId = text(req.body.deviceId, 40);
    const name = text(req.body.name, 80);
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const existing = db.prepare('SELECT * FROM hardware_devices WHERE user_id = ? AND device_id = ?').get(req.user.id, deviceId);
    if (existing) {
      return res.json({ device: existing, token: existing.device_token });
    }

    const token = generateDeviceToken();
    db.prepare('INSERT INTO hardware_devices (user_id, device_id, device_token, name) VALUES (?, ?, ?, ?)')
      .run(req.user.id, deviceId, token, name);
    const row = db.prepare('SELECT * FROM hardware_devices WHERE id = last_insert_rowid()').get();
    res.status(201).json({ device: row, token: row.device_token });
  });

  router.get('/devices', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM hardware_devices WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(req.user.id);
    res.json({ devices: rows });
  });

  router.delete('/devices/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid device' });
    const result = db.prepare('DELETE FROM hardware_devices WHERE id = ? AND user_id = ?').run(id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'device not found' });
    res.json({ ok: true });
  });

  // ---- 事件上传（设备令牌认证 + 原始二进制体）----
  router.post('/events',
    requireDevice(db),
    express.raw({ type: 'application/octet-stream', limit: MAX_EVENT_BYTES }),
    (req, res, next) => {
      const device = req.device;
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'empty binary body' });
      }

      let parsed;
      try {
        parsed = decodeEvent(req.body);
      } catch (error) {
        return res.status(400).json({ error: `invalid event binary: ${error.message}` });
      }

      const { header, samples, footer } = parsed;
      if (header.deviceId && header.deviceId !== device.device_id) {
        return res.status(403).json({ error: 'event deviceId does not match device token' });
      }

      // 幂等：同一设备的同一 event_id 只入库一次。
      const existing = db.prepare('SELECT * FROM hardware_events WHERE device_id = ? AND event_id = ?')
        .get(device.id, header.eventId);
      if (existing) {
        return res.json({ ok: true, duplicate: true, event: eventJson(existing) });
      }

      const insertEvent = db.prepare(`
        INSERT INTO hardware_events (
          device_id, user_id, event_id, event_sequence, event_utc_ms, boot_id,
          time_quality, status, pre_count, active_count, sample_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertSample = db.prepare(`
        INSERT INTO hardware_samples (
          event_id, sample_index, monotonic_us, utc_epoch_ms, boot_id,
          sampling_mode, time_quality, light_lux, temperature_c,
          humidity_percent, noise_db_spl, valid_mask
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      try {
        db.exec('BEGIN IMMEDIATE');
        const info = insertEvent.run(
          device.id, device.user_id, header.eventId, header.eventSequence,
          header.eventUtcMs || null, header.bootId, header.timeQuality,
          footer.status, footer.preCount, footer.activeCount, samples.length
        );
        const eventPk = Number(info.lastInsertRowid);

        for (let index = 0; index < samples.length; index += 1) {
          const s = samples[index];
          insertSample.run(
            eventPk, index, s.monotonicUs || null, s.utcEpochMs || null,
            s.bootId, s.mode, s.timeQuality,
            finiteOrNull(s.lightLux), finiteOrNull(s.temperatureC),
            finiteOrNull(s.humidityPercent), finiteOrNull(s.noiseDbSpl),
            s.validMask
          );
        }
        db.prepare('UPDATE hardware_devices SET last_seen_at = datetime(\'now\') WHERE id = ?').run(device.id);
        db.exec('COMMIT');

        const row = db.prepare('SELECT * FROM hardware_events WHERE id = ?').get(eventPk);
        res.status(201).json({ ok: true, event: eventJson(row), samplesStored: samples.length });
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch (rollbackError) { /* transaction inactive */ }
        return next(error);
      }
    });

  // ---- 查询（需登录）----
  router.get('/events', requireAuth, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const rows = db.prepare('SELECT * FROM hardware_events WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(req.user.id, limit);
    res.json({ events: rows.map(eventJson) });
  });

  router.get('/events/:id/samples', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid event' });
    const event = db.prepare('SELECT * FROM hardware_events WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!event) return res.status(404).json({ error: 'event not found' });
    const samples = db.prepare('SELECT * FROM hardware_samples WHERE event_id = ? ORDER BY sample_index ASC').all(id);
    res.json({ event: eventJson(event), samples });
  });

  return router;
}

const router = createHardwareRouter();
module.exports = router;
module.exports.createHardwareRouter = createHardwareRouter;
module.exports._helpers = { generateDeviceToken, finiteOrNull };

