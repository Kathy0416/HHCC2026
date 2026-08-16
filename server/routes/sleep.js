const express = require('express');
const { requireAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toRecord(row) {
  return {
    date: row.date,
    sleepTime: row.sleep_time,
    wakeTime: row.wake_time,
    duration: {
      hours: row.duration_hours,
      minutes: row.duration_minutes,
      totalMinutes: row.duration_total_minutes
    },
    quality: row.quality
  };
}

// 获取当前用户的全部睡眠记录（按日期倒序）
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM sleep_records WHERE user_id = ? ORDER BY date DESC')
    .all(req.user.id);
  res.json({ records: rows.map(toRecord) });
});

// 保存某一天的睡眠记录（存在则更新）
router.put('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  }

  const sleepTime = String(req.body.sleepTime || '');
  const wakeTime = String(req.body.wakeTime || '');
  const quality = String(req.body.quality || '');
  const duration = req.body.duration || {};
  const hours = Number(duration.hours) || 0;
  const minutes = Number(duration.minutes) || 0;
  const totalMinutes = Number(duration.totalMinutes) || hours * 60 + minutes;

  db.prepare(`
    INSERT INTO sleep_records (user_id, date, sleep_time, wake_time, duration_hours, duration_minutes, duration_total_minutes, quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      sleep_time = excluded.sleep_time,
      wake_time = excluded.wake_time,
      duration_hours = excluded.duration_hours,
      duration_minutes = excluded.duration_minutes,
      duration_total_minutes = excluded.duration_total_minutes,
      quality = excluded.quality
  `).run(req.user.id, date, sleepTime, wakeTime, hours, minutes, totalMinutes, quality);

  const row = db.prepare('SELECT * FROM sleep_records WHERE user_id = ? AND date = ?').get(req.user.id, date);
  res.json({ record: toRecord(row) });
});

// 删除某一天的睡眠记录
router.delete('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
  }
  db.prepare('DELETE FROM sleep_records WHERE user_id = ? AND date = ?').run(req.user.id, date);
  res.json({ ok: true });
});

module.exports = router;
