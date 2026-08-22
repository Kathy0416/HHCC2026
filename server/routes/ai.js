'use strict';

const express = require('express');
const { optionalAuth } = require('../middleware');
const { buildAnalysis, safeJson, todayInZone } = require('../health-analysis');
const { getAiProfile } = require('../ai-prompts');
const defaultDb = require('../db');

const CONTEXT_DAYS = 90;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 20;
const REQUEST_TIMEOUT_MS = 30000;

function shiftDate(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function boundedText(value, maximum = MAX_MESSAGE_LENGTH) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function sanitizeHistory(value, currentMessage) {
  if (!Array.isArray(value)) return [];
  const history = value
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant'))
    .map((item) => ({ role: item.role, content: boundedText(item.content) }))
    .filter((item) => item.content)
    .slice(-MAX_HISTORY_ITEMS);
  const last = history[history.length - 1];
  if (last && last.role === 'user' && last.content === currentMessage) history.pop();
  return history;
}

function loadPersonalContext(db, userId, locale) {
  const latestHealth = db.prepare('SELECT timezone FROM health_daily WHERE user_id = ? ORDER BY local_date DESC LIMIT 1').get(userId);
  const latestEnvironment = db.prepare('SELECT timezone FROM environment_readings WHERE user_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1').get(userId);
  const endDate = todayInZone((latestHealth && latestHealth.timezone) || (latestEnvironment && latestEnvironment.timezone));
  const startDate = shiftDate(endDate, -CONTEXT_DAYS + 1);
  const calendarRows = db.prepare('SELECT * FROM calendar_entries WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC').all(userId, startDate, endDate);
  const manualRows = db.prepare('SELECT * FROM sleep_records WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC').all(userId, startDate, endDate);
  const wearableRows = db.prepare('SELECT * FROM health_daily WHERE user_id = ? AND local_date BETWEEN ? AND ? ORDER BY local_date ASC').all(userId, startDate, endDate);
  const environmentRows = db.prepare(`
    SELECT local_date,
      AVG(temperature_c) AS temperature_avg,
      AVG(humidity_pct) AS humidity_avg,
      AVG(light_lux) AS light_avg,
      AVG(noise_db) AS noise_avg
    FROM environment_readings
    WHERE user_id = ? AND local_date BETWEEN ? AND ?
    GROUP BY local_date
    ORDER BY local_date ASC
  `).all(userId, startDate, endDate);

  const analysis = buildAnalysis({ range: CONTEXT_DAYS, endDate, wearableRows, manualRows, calendarRows, environmentRows });
  const diaryByDate = new Map(calendarRows.map((row) => [row.date, row]));
  const recordedDays = analysis.series.filter((day) => (
    day.hasDiaryEntry || day.sleepMinutes != null || day.heartRateAvg != null || day.spo2Avg != null ||
    day.steps != null || day.temperatureAvg != null || day.humidityAvg != null || day.lightAvg != null || day.noiseAvg != null
  )).map((day) => {
    const diary = diaryByDate.get(day.date);
    return {
      ...day,
      diary: diary && diary.diary ? boundedText(diary.diary, 600) : null,
      triggers: diary ? safeJson(diary.triggers, []) : []
    };
  });

  const usedDataCategories = [];
  if (calendarRows.length) usedDataCategories.push('migraine');
  if (manualRows.length || wearableRows.some((row) => row.sleep_duration_minutes != null)) usedDataCategories.push('sleep');
  if (wearableRows.some((row) => row.heart_rate_count || row.spo2_count || row.steps != null)) usedDataCategories.push('wearable');
  if (environmentRows.length) usedDataCategories.push('environment');

  return {
    usedDataCategories,
    context: {
      locale,
      range: { days: CONTEXT_DAYS, startDate, endDate },
      dataCategories: usedDataCategories,
      summary: { kpis: analysis.kpis, coverage: analysis.coverage, comparisons: analysis.comparisons },
      recordedDays
    }
  };
}

function errorCopy(locale, key) {
  const messages = {
    en: {
      empty: 'Enter a message before sending.',
      tooLong: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
      notConfigured: 'DeepSeek is not configured on the server. Add DEEPSEEK_API_KEY to server/.env and restart the server.',
      unavailable: 'DeepSeek is temporarily unavailable. Please try again later.'
    },
    'zh-CN': {
      empty: '请输入消息后再发送。',
      tooLong: `每条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符。`,
      notConfigured: '服务器尚未配置 DeepSeek。请在 server/.env 中添加 DEEPSEEK_API_KEY 并重启服务器。',
      unavailable: 'DeepSeek 暂时不可用，请稍后再试。'
    }
  };
  return (messages[locale] || messages['zh-CN'])[key];
}

function createAiRouter(db = defaultDb, options = {}) {
  const router = express.Router();
  const apiUrl = options.apiUrl || process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
  const model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const apiKey = options.apiKey === undefined ? (process.env.DEEPSEEK_API_KEY || '') : options.apiKey;
  const fetchImpl = options.fetchImpl || global.fetch;
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;

  router.post('/chat', optionalAuth, async (req, res) => {
    const rawMessage = String(req.body && req.body.message || '').trim();
    if (!rawMessage) return res.status(400).json({ code: 'EMPTY_MESSAGE', error: errorCopy(req.locale, 'empty') });
    if (rawMessage.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ code: 'MESSAGE_TOO_LONG', error: errorCopy(req.locale, 'tooLong') });
    if (!apiKey) return res.status(503).json({ code: 'AI_NOT_CONFIGURED', error: errorCopy(req.locale, 'notConfigured') });

    const message = boundedText(rawMessage);
    const history = sanitizeHistory(req.body.history, message);
    const profile = getAiProfile(req.locale);
    const personal = req.user ? loadPersonalContext(db, req.user.id, req.locale) : { context: null, usedDataCategories: [] };
    const messages = [
      { role: 'system', content: profile.systemPrompt },
      ...(personal.context && personal.usedDataCategories.length ? [{ role: 'system', content: `<personal_data>\n${JSON.stringify(personal.context)}\n</personal_data>` }] : []),
      ...history,
      { role: 'user', content: message }
    ];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          thinking: { type: 'disabled' },
          max_tokens: 1000,
          stream: false,
          ...(req.user ? { user_id: `migraine-${req.user.id}` } : {})
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const upstreamBody = await response.text();
        console.error(`[ai] DeepSeek request failed (${response.status}):`, upstreamBody.slice(0, 500));
        return res.status(502).json({ code: 'AI_UPSTREAM_ERROR', error: errorCopy(req.locale, 'unavailable') });
      }
      const data = await response.json();
      const reply = data && data.choices && data.choices[0] && data.choices[0].message
        ? boundedText(data.choices[0].message.content, 12000)
        : '';
      if (!reply) return res.status(502).json({ code: 'AI_INVALID_RESPONSE', error: errorCopy(req.locale, 'unavailable') });

      if (req.user) {
        const insert = db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)');
        insert.run(req.user.id, 'user', message);
        insert.run(req.user.id, 'assistant', reply);
      }
      return res.json({ reply, provider: 'deepseek', personalized: personal.usedDataCategories.length > 0, usedDataCategories: personal.usedDataCategories });
    } catch (error) {
      console.error('[ai] DeepSeek request failed:', error && error.message);
      return res.status(502).json({ code: error && error.name === 'AbortError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', error: errorCopy(req.locale, 'unavailable') });
    } finally {
      clearTimeout(timer);
    }
  });

  router.get('/history', optionalAuth, (req, res) => {
    if (!req.user) return res.json({ messages: [] });
    const rows = db.prepare(`
      SELECT role, content, created_at FROM chat_messages
      WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(req.user.id, 50).reverse();
    return res.json({ messages: rows.map((row) => ({ role: row.role, content: row.content, timestamp: row.created_at })) });
  });

  return router;
}

const router = createAiRouter();
module.exports = router;
module.exports.createAiRouter = createAiRouter;
module.exports._internals = { loadPersonalContext, sanitizeHistory, MAX_HISTORY_ITEMS, MAX_MESSAGE_LENGTH };
