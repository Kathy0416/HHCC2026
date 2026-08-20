const express = require('express');
const { optionalAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const SYSTEM_PROMPT = '你是偏头痛记录应用中的智能健康助手。你可以访问用户在本应用中记录的偏头痛发作数据，并结合这些数据为用户提供个性化、贴合其记录的建议。回答应温和、实用、符合健康安全，不提供医疗诊断、不替代医生。请保持回答简短精炼，直接给出要点，避免冗长的长篇大论。';

// 服务端本地模拟回复（未配置 DeepSeek Key 或调用失败时使用）
function mockReply(message) {
  const lower = String(message || '').toLowerCase();

  if (lower.includes('偏头痛') || lower.includes('头痛')) {
    return '偏头痛是一种常见的神经系统疾病，特征是反复发作的中重度头痛，通常伴有恶心、呕吐、对光和声音敏感。建议保持规律的作息、避免触发因素，如压力、缺乏睡眠、某些食物等。如果症状严重，建议咨询医生。';
  }
  if (lower.includes('吃了') || lower.includes('食物') || lower.includes('巧克力') || lower.includes('咖啡') || lower.includes('酒精') || lower.includes('不舒服')) {
    return '某些食物确实可能触发偏头痛，常见的包括巧克力、咖啡因、酒精、含有硝酸盐的食物等。如果刚吃完后感到不舒服，建议：1. 在安静黑暗的房间休息；2. 多喝水帮助代谢；3. 记录这次发作，以便识别个人触发因素；4. 若症状严重可咨询医生。';
  }
  if (lower.includes('触发因素') || lower.includes('原因') || lower.includes('为什么')) {
    return '偏头痛的常见触发因素包括：压力、睡眠不足或过多、饮食因素（如酒精、咖啡因、巧克力、硝酸盐等）、荷尔蒙变化、环境因素（如强光、噪音、天气变化）等。';
  }
  if (lower.includes('治疗') || lower.includes('缓解') || lower.includes('怎么办') || lower.includes('怎么治')) {
    return '偏头痛的治疗包括：在安静、黑暗的房间休息，必要时服用止痛药，避免触发因素，保持规律的生活习惯，尝试放松技巧（如深呼吸、冥想），严重时可咨询医生使用处方药。';
  }
  if (lower.includes('记录') || lower.includes('日记') || lower.includes('跟踪')) {
    return '记录偏头痛发作情况有助于识别触发因素和规律。建议记录发作时间、持续时间、疼痛程度、伴随症状，以及当天的饮食、睡眠、压力水平等信息。';
  }
  if (lower.includes('症状') || lower.includes('表现') || lower.includes('感觉')) {
    return '偏头痛的典型症状包括：单侧搏动性头痛、中重度疼痛、恶心呕吐、对光和声音敏感、有时伴有视觉先兆（如闪光、暗点）等。症状通常持续 4-72 小时。';
  }
  if (lower.includes('睡眠')) {
    return '睡眠不足和睡眠过多都可能诱发偏头痛。建议保持固定的入睡和起床时间，营造舒适的睡眠环境，睡前避免咖啡因和电子屏幕，并结合睡眠记录观察规律。';
  }
  if (lower.includes('苹果') || lower.includes('水果')) {
    return '苹果通常被认为是健康食品，不是偏头痛的典型触发因素。建议观察自身反应，如果你有明确关联，可以继续记录；否则继续保持均衡饮食与规律作息。';
  }
  return '抱歉，我不太明白你的问题。我是一个专注于偏头痛相关问题的 AI 助手，你可以问我关于偏头痛的症状、触发因素、治疗方法、睡眠、饮食等问题。';
}

// 读取用户的偏头痛发作记录，格式化后作为 AI 上下文
function getUserMigraineRecords(userId) {
  const rows = db
    .prepare('SELECT * FROM calendar_entries WHERE user_id = ? AND migraine = 1 ORDER BY date DESC LIMIT 50')
    .all(userId);
  return rows.map((r) => {
    let triggers = [];
    try {
      triggers = JSON.parse(r.triggers || '[]');
    } catch (e) {
      triggers = [];
    }
    return {
      date: r.date,
      diary: r.diary || '未填写日记',
      triggers: triggers.length ? triggers.join('、') : '未记录'
    };
  });
}

// 生成用户发作记录的上下文文本（作为独立消息注入，让 AI 明确"已拥有"这些数据）
function buildRecordsContext(records) {
  if (!records || records.length === 0) return '';
  const lines = records
    .map((r) => `- ${r.date}：${r.diary}（触发因素：${r.triggers}）`)
    .join('\n');
  return `该用户在本应用中记录的偏头痛发作数据如下（共 ${records.length} 次，按日期倒序）：\n${lines}`;
}

// 本地模拟回复时，结合用户的发作记录做简单统计（未配置 DeepSeek Key 时使用）
function mockReplyWithRecords(message, records) {
  const lower = String(message || '').toLowerCase();
  if (
    records &&
    records.length > 0 &&
    (lower.includes('几次') || lower.includes('多少') || lower.includes('记录') || lower.includes('发作') || lower.includes('统计'))
  ) {
    const latest = records[0];
    const recent = records.slice(0, 5).map((r) => r.date).join('、');
    return `根据你的记录，你目前共记录了 ${records.length} 次偏头痛发作。最近一次是 ${latest.date}（${latest.diary}，触发因素：${latest.triggers}）。最近几次发作日期：${recent}。`;
  }
  return null;
}

// 对话接口（代理 DeepSeek，密钥保存在服务端）
router.post('/chat', optionalAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: '消息不能为空' });
  }

  const history = Array.isArray(req.body.history) ? req.body.history : [];

  let reply;
  let mock = false;

  if (!DEEPSEEK_API_KEY) {
    const records = req.user ? getUserMigraineRecords(req.user.id) : [];
    const withRecords = mockReplyWithRecords(message, records);
    reply = withRecords || mockReply(message);
    mock = true;
  } else {
    try {
      const records = req.user ? getUserMigraineRecords(req.user.id) : [];
      const recordsContext = buildRecordsContext(records);
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(recordsContext ? [{ role: 'user', content: recordsContext }] : []),
        ...history.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || '')
        })),
        { role: 'user', content: message }
      ];

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, stream: false })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`DeepSeek API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
        ? data.choices[0].message.content.trim()
        : null;

      if (!reply) {
        throw new Error('DeepSeek API 返回无效数据');
      }
    } catch (err) {
      console.error('[ai] DeepSeek 调用失败，回退本地模拟：', err.message);
      reply = `${mockReply(message)}\n\n（DeepSeek 调用失败，已回退本地模拟回复）`;
      mock = true;
    }
  }

  // 登录用户持久化聊天记录
  if (req.user) {
    db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'user', message);
    db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(req.user.id, 'assistant', reply);
  }

  res.json({ reply, mock });
});

// 获取登录用户的聊天历史
router.get('/history', optionalAuth, (req, res) => {
  if (!req.user) {
    return res.json({ messages: [] });
  }
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC')
    .all(req.user.id);
  res.json({ messages: rows.map((r) => ({ role: r.role, content: r.content, timestamp: r.created_at })) });
});

module.exports = router;
