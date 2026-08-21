const express = require('express');
const { requireAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();
router.use(requireAuth);

const SESSION_TYPES = new Set(['migraine', 'baseline']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toReal(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 上传一次会话的完整环境读数（发作事件 或 正常对照组）
// 幂等：同一 (user_id, session_key) 不会重复建会话；
//       同一 (session_id, t_ms) 不会重复插入读数，保证无缺漏、无重复。
router.post('/upload', (req, res) => {
  const session = req.body.session || {};
  const readings = Array.isArray(req.body.readings) ? req.body.readings : [];

  const deviceId = String(session.device_id || '').trim();
  const sessionKey = String(session.session_key || '').trim();
  const sessionType = String(session.session_type || '').trim();
  const startedAt = String(session.started_at || '').trim();
  const endedAt = session.ended_at ? String(session.ended_at).trim() : null;

  if (!deviceId || !sessionKey || !SESSION_TYPES.has(sessionType) || !startedAt) {
    return res.status(400).json({
      error: 'session 缺少必要字段：device_id / session_key / session_type / started_at'
    });
  }
  if (readings.length === 0) {
    return res.status(400).json({ error: 'readings 不能为空' });
  }
  for (const r of readings) {
    if (!Number.isFinite(Number(r.t_ms))) {
      return res.status(400).json({ error: 'readings 中存在无效的 t_ms' });
    }
  }

  // 发作事件需写回日历：优先用前端提供的本地日期，否则取 started_at 的日期部分
  const date = String(session.local_date || startedAt.slice(0, 10)).trim();
  if (sessionType === 'migraine' && !DATE_RE.test(date)) {
    return res.status(400).json({
      error: 'local_date 或 started_at 的日期格式应为 YYYY-MM-DD'
    });
  }

  try {
    db.exec('BEGIN IMMEDIATE');

    db.prepare(`
      INSERT INTO device_sessions (user_id, device_id, session_key, session_type, started_at, ended_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, session_key) DO NOTHING
    `).run(req.user.id, deviceId, sessionKey, sessionType, startedAt, endedAt);

    const sessionRow = db.prepare(
      'SELECT id FROM device_sessions WHERE user_id = ? AND session_key = ?'
    ).get(req.user.id, sessionKey);

    if (!sessionRow) {
      db.exec('ROLLBACK');
      return res.status(500).json({ error: '创建/获取会话失败' });
    }
    const sessionId = sessionRow.id;

    const insertReading = db.prepare(`
      INSERT INTO sensor_readings
        (session_id, t_ms, lux, temperature_c, humidity_percent, db_spl, light_valid, sht31_valid, mic_valid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, t_ms) DO NOTHING
    `);

    let inserted = 0;
    for (const r of readings) {
      const result = insertReading.run(
        sessionId,
        Math.trunc(Number(r.t_ms)),
        toReal(r.lux),
        toReal(r.temperature_c),
        toReal(r.humidity_percent),
        toReal(r.db_spl),
        r.light_valid ? 1 : 0,
        r.sht31_valid ? 1 : 0,
        r.mic_valid ? 1 : 0
      );
      inserted += result.changes;
    }

    // 发作事件同时把当天标记为偏头痛（保留用户已填写的 diary/triggers）
    if (sessionType === 'migraine') {
      const lastUpdated = new Date().toISOString();
      db.prepare(`
        INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers, last_updated)
        VALUES (?, ?, 1, '', '[]', ?)
        ON CONFLICT(user_id, date) DO UPDATE SET
          migraine = 1,
          last_updated = excluded.last_updated
      `).run(req.user.id, date, lastUpdated);
    }

    db.exec('COMMIT');

    res.json({
      ok: true,
      session_id: sessionId,
      session_type: sessionType,
      inserted_readings: inserted,
      date: sessionType === 'migraine' ? date : null
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) { /* 忽略回滚失败 */ }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 查询当前用户的设备会话列表
router.get('/sessions', (req, res) => {
  const sessions = db.prepare(
    'SELECT * FROM device_sessions WHERE user_id = ? ORDER BY started_at DESC'
  ).all(req.user.id);
  res.json({ sessions });
});

// 查询某个会话的读数
router.get('/sessions/:id/readings', (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: '无效的会话 id' });
  }

  const session = db.prepare(
    'SELECT * FROM device_sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, req.user.id);

  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }

  const readings = db.prepare(
    'SELECT * FROM sensor_readings WHERE session_id = ? ORDER BY t_ms ASC'
  ).all(sessionId);

  res.json({ session, readings });
});

module.exports = router;
