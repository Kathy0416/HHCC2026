'use strict';

// 读数查询/写入接口。
// - 环境读数（温湿度、光照强度）：来自 ESP32 固件上传的 hardware_samples，逐条带 UTC 毫秒时间戳。
// - 体征读数（心率、血氧、步数）：来自 vitals_readings，同样逐条带时间戳。
// 前端 sleep 页面按日期聚合后用于图表，调试页则用表格直接展示原始读数。

const express = require('express');
const { requireAuth } = require('../middleware');
const defaultDb = require('../db');

const MAX_LIMIT = 5000;

function clampLimit(value, fallback = 200) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, MAX_LIMIT);
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function optionalTs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// 环境读数行 → 统一 JSON（时间戳毫秒 + 传感器字段）
function environmentJson(row) {
  return {
    utcEpochMs: row.utc_epoch_ms,
    temperatureC: finiteOrNull(row.temperature_c),
    humidityPercent: finiteOrNull(row.humidity_percent),
    lightLux: finiteOrNull(row.light_lux),
    noiseDbSpl: finiteOrNull(row.noise_db_spl),
    validMask: row.valid_mask,
    deviceId: row.device_id
  };
}

function vitalsJson(row) {
  return {
    utcEpochMs: row.utc_epoch_ms,
    heartRate: finiteOrNull(row.heart_rate),
    spo2: finiteOrNull(row.spo2),
    steps: row.steps == null ? null : Number(row.steps),
    source: row.source
  };
}

function createReadingsRouter(db = defaultDb) {
  const router = express.Router();
  router.use(requireAuth);

  // 环境读数（温湿度 / 光照 / 噪音）
  router.get('/environment', (req, res) => {
    const limit = clampLimit(req.query.limit);
    const start = optionalTs(req.query.start);
    const end = optionalTs(req.query.end);
    const where = ['e.user_id = ?'];
    const params = [req.user.id];
    if (start != null) { where.push('s.utc_epoch_ms >= ?'); params.push(start); }
    if (end != null) { where.push('s.utc_epoch_ms <= ?'); params.push(end); }
    params.push(limit);
    const rows = db.prepare(`
      SELECT s.utc_epoch_ms, s.light_lux, s.temperature_c, s.humidity_percent, s.noise_db_spl, s.valid_mask, d.device_id
      FROM hardware_samples s
      JOIN hardware_events e ON e.id = s.event_id
      JOIN hardware_devices d ON d.id = e.device_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.utc_epoch_ms DESC LIMIT ?
    `).all(...params);
    res.json({ readings: rows.map(environmentJson) });
  });

  // 体征读数（心率 / 血氧 / 步数）
  router.get('/vitals', (req, res) => {
    const limit = clampLimit(req.query.limit);
    const start = optionalTs(req.query.start);
    const end = optionalTs(req.query.end);
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (start != null) { where.push('utc_epoch_ms >= ?'); params.push(start); }
    if (end != null) { where.push('utc_epoch_ms <= ?'); params.push(end); }
    params.push(limit);
    const rows = db.prepare(`
      SELECT utc_epoch_ms, heart_rate, spo2, steps, source
      FROM vitals_readings
      WHERE ${where.join(' AND ')}
      ORDER BY utc_epoch_ms DESC LIMIT ?
    `).all(...params);
    res.json({ readings: rows.map(vitalsJson) });
  });

  // 批量写入体征读数（来自可穿戴设备同步 / 调试注入）
  router.post('/vitals', (req, res) => {
    const items = Array.isArray(req.body) ? req.body : (req.body && req.body.readings);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: req.t('invalidReadings') });
    }
    if (items.length > MAX_LIMIT) {
      return res.status(400).json({ error: req.t('tooManyReadings') });
    }

    const insert = db.prepare(`
      INSERT INTO vitals_readings (user_id, source, utc_epoch_ms, heart_rate, spo2, steps)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    try {
      db.exec('BEGIN IMMEDIATE');
      for (const item of items) {
        const utcEpochMs = Number(item && item.utcEpochMs);
        if (!Number.isFinite(utcEpochMs)) continue;
        const source = String((item && item.source) || 'wearable').slice(0, 40);
        insert.run(
          req.user.id,
          source,
          Math.round(utcEpochMs),
          finiteOrNull(item.heartRate),
          finiteOrNull(item.spo2),
          item.steps == null ? null : Math.round(Number(item.steps))
        );
        inserted += 1;
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (rollbackError) { /* transaction inactive */ }
      return next(error);
    }
    res.status(201).json({ ok: true, inserted });
  });

  return router;
}

const router = createReadingsRouter();
module.exports = router;
module.exports.createReadingsRouter = createReadingsRouter;
module.exports._helpers = { environmentJson, vitalsJson, clampLimit };
