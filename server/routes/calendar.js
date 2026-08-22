const express = require('express');
const { requireAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toEntry(row) {
  let triggers = [];
  try {
    triggers = JSON.parse(row.triggers || '[]');
  } catch (e) {
    triggers = [];
  }
  return {
    date: row.date,
    migraine: !!row.migraine,
    diary: row.diary,
    triggers,
    lastUpdated: row.last_updated
  };
}

// 获取当前用户的全部日历记录
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM calendar_entries WHERE user_id = ? ORDER BY date ASC')
    .all(req.user.id);

  const byDate = {};
  const entries = rows.map((r) => {
    const entry = toEntry(r);
    byDate[entry.date] = entry;
    return entry;
  });

  res.json({ entries, byDate });
});

// 保存某一天的记录（存在则更新）
router.put('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: req.t('invalidDate') });
  }

  const migraine = req.body.migraine ? 1 : 0;
  const diary = String(req.body.diary || '');
  const triggers = JSON.stringify(Array.isArray(req.body.triggers) ? req.body.triggers : []);
  const lastUpdated = new Date().toISOString();

  db.prepare(`
    INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers, last_updated)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      migraine = excluded.migraine,
      diary = excluded.diary,
      triggers = excluded.triggers,
      last_updated = excluded.last_updated
  `).run(req.user.id, date, migraine, diary, triggers, lastUpdated);

  const row = db.prepare('SELECT * FROM calendar_entries WHERE user_id = ? AND date = ?').get(req.user.id, date);
  res.json({ entry: toEntry(row) });
});

// 删除某一天的记录
router.delete('/:date', (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: req.t('invalidDate') });
  }
  db.prepare('DELETE FROM calendar_entries WHERE user_id = ? AND date = ?').run(req.user.id, date);
  res.json({ ok: true });
});

module.exports = router;
