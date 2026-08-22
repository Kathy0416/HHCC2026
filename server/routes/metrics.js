'use strict';

const express = require('express');
const { requireAuth } = require('../middleware');
const defaultDb = require('../db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 每个因素单独一张表：偏头痛时长、血氧、心跳、步数
const METRICS = [
  { key: 'migraine-duration', table: 'migraine_duration_records', valueColumn: 'duration_minutes', integer: true },
  { key: 'spo2', table: 'spo2_records', valueColumn: 'spo2', integer: false },
  { key: 'heart-rate', table: 'heart_rate_records', valueColumn: 'bpm', integer: false },
  { key: 'steps', table: 'steps_records', valueColumn: 'steps', integer: true }
];

function toRecord(metric, row) {
  if (!row) return null;
  return { date: row.date, value: row[metric.valueColumn], lastUpdated: row.last_updated };
}

function createMetricsRouter(db = defaultDb) {
  const router = express.Router();
  router.use(requireAuth);

  for (const metric of METRICS) {
    // 获取该指标的全部记录
    router.get(`/${metric.key}`, (req, res) => {
      const rows = db
        .prepare(`SELECT * FROM ${metric.table} WHERE user_id = ? ORDER BY date ASC`)
        .all(req.user.id);
      res.json({ records: rows.map((row) => toRecord(metric, row)) });
    });

    // 保存某一天的记录（存在则更新）
    router.put(`/${metric.key}/:date`, (req, res) => {
      const { date } = req.params;
      if (!DATE_RE.test(date)) return res.status(400).json({ error: req.t('invalidDate') });

      const raw = req.body && req.body.value;
      const number = Number(raw);
      if (raw == null || raw === '' || !Number.isFinite(number) || number < 0) {
        return res.status(400).json({ error: req.t('invalidMetricValue') });
      }
      const value = metric.integer ? Math.round(number) : number;
      const lastUpdated = new Date().toISOString();

      db.prepare(`
        INSERT INTO ${metric.table} (user_id, date, ${metric.valueColumn}, last_updated)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          ${metric.valueColumn} = excluded.${metric.valueColumn},
          last_updated = excluded.last_updated
      `).run(req.user.id, date, value, lastUpdated);

      const row = db.prepare(`SELECT * FROM ${metric.table} WHERE user_id = ? AND date = ?`).get(req.user.id, date);
      res.json({ record: toRecord(metric, row) });
    });

    // 删除某一天的记录
    router.delete(`/${metric.key}/:date`, (req, res) => {
      const { date } = req.params;
      if (!DATE_RE.test(date)) return res.status(400).json({ error: req.t('invalidDate') });
      db.prepare(`DELETE FROM ${metric.table} WHERE user_id = ? AND date = ?`).run(req.user.id, date);
      res.json({ ok: true });
    });
  }

  return router;
}

const router = createMetricsRouter();
module.exports = router;
module.exports.createMetricsRouter = createMetricsRouter;
