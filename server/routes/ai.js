const express = require('express');
const { optionalAuth } = require('../middleware');
const { interpolate } = require('../i18n');
const catalog = require('../../locales');
const db = require('../db');

const router = express.Router();
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

function aiCopy(locale) {
  return catalog.ai[locale] || catalog.ai['zh-CN'];
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

function mockReply(message, locale = 'zh-CN') {
  const lower = String(message || '').toLowerCase();
  const copy = aiCopy(locale);
  if (includesAny(lower, ['偏头痛', '头痛', 'migraine', 'headache'])) return copy.migraineReply;
  if (includesAny(lower, ['吃了', '食物', '巧克力', '咖啡', '酒精', '不舒服', 'food', 'chocolate', 'coffee', 'alcohol'])) return copy.foodReply;
  if (includesAny(lower, ['触发因素', '原因', '为什么', 'trigger', 'cause', 'why'])) return copy.triggerReply;
  if (includesAny(lower, ['治疗', '缓解', '怎么办', '怎么治', 'treat', 'relief', 'help'])) return copy.treatmentReply;
  if (includesAny(lower, ['记录', '日记', '跟踪', 'record', 'diary', 'track'])) return copy.trackingReply;
  if (includesAny(lower, ['症状', '表现', '感觉', 'symptom', 'feel'])) return copy.symptomReply;
  if (includesAny(lower, ['睡眠', 'sleep'])) return copy.sleepReply;
  if (includesAny(lower, ['苹果', '水果', 'apple', 'fruit'])) return copy.fruitReply;
  return copy.defaultReply;
}

function getUserMigraineRecords(userId, locale) {
  const copy = aiCopy(locale);
  const rows = db
    .prepare('SELECT * FROM calendar_entries WHERE user_id = ? AND migraine = 1 ORDER BY date DESC LIMIT 50')
    .all(userId);
  return rows.map((row) => {
    let triggers = [];
    try {
      triggers = JSON.parse(row.triggers || '[]');
    } catch (error) {
      triggers = [];
    }
    return {
      date: row.date,
      diary: row.diary || copy.noDiary,
      triggers: triggers.length ? triggers.join(locale === 'en' ? ', ' : '、') : copy.noTriggers
    };
  });
}

function buildRecordsContext(records, locale) {
  if (!records.length) return '';
  const copy = aiCopy(locale);
  const lines = records.map((record) => (
    locale === 'en'
      ? `- ${record.date}: ${record.diary} (${copy.triggerLabel}: ${record.triggers})`
      : `- ${record.date}：${record.diary}（${copy.triggerLabel}：${record.triggers}）`
  )).join('\n');
  return `${interpolate(copy.recordsIntro, { count: records.length })}\n${lines}`;
}

function mockReplyWithRecords(message, records, locale) {
  const lower = String(message || '').toLowerCase();
  if (!records.length || !includesAny(lower, ['几次', '多少', '记录', '发作', '统计', 'how many', 'record', 'attack', 'stat'])) return null;
  const latest = records[0];
  const dates = records.slice(0, 5).map((record) => record.date).join(locale === 'en' ? ', ' : '、');
  return interpolate(aiCopy(locale).recordsReply, {
    count: records.length,
    date: latest.date,
    diary: latest.diary,
    triggers: latest.triggers,
    dates
  });
}

router.post('/chat', optionalAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: req.t('emptyMessage') });

  const history = Array.isArray(req.body.history) ? req.body.history : [];
  const locale = req.locale;
  const records = req.user ? getUserMigraineRecords(req.user.id, locale) : [];
  let reply;
  let mock = false;

  if (!DEEPSEEK_API_KEY) {
    reply = mockReplyWithRecords(message, records, locale) || mockReply(message, locale);
    mock = true;
  } else {
    try {
      const recordsContext = buildRecordsContext(records, locale);
      const messages = [
        { role: 'system', content: aiCopy(locale).systemPrompt },
        ...(recordsContext ? [{ role: 'user', content: recordsContext }] : []),
        ...history.map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: String(item.content || '')
        })),
        { role: 'user', content: message }
      ];
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false })
      });
      if (!response.ok) throw new Error(`DeepSeek API error ${response.status}: ${await response.text()}`);
      const data = await response.json();
      reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('DeepSeek returned an invalid response');
    } catch (error) {
      console.error('[ai] DeepSeek request failed; using local response:', error.message);
      reply = `${mockReply(message, locale)}\n\n${aiCopy(locale).fallbackSuffix}`;
      mock = true;
    }
  }

  if (req.user) {
    db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'user', message);
    db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'assistant', reply);
  }
  res.json({ reply, mock });
});

router.get('/history', optionalAuth, (req, res) => {
  if (!req.user) return res.json({ messages: [] });
  const rows = db.prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC').all(req.user.id);
  res.json({ messages: rows.map((row) => ({ role: row.role, content: row.content, timestamp: row.created_at })) });
});

module.exports = router;