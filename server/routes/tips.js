const express = require('express');
const { optionalAuth, requireAuth } = require('../middleware');
const db = require('../db');
const catalog = require('../../locales');
const { serializeTip } = require('../builtin-tips');

const router = express.Router();

function toComment(row, locale = 'zh-CN') {
  const isAnonymous = row.author === '__anonymous__' || row.author === '匿名' || row.author === 'Anonymous';
  return {
    id: row.id,
    author: isAnonymous ? catalog.keys[locale]['common.anonymous'] : row.author,
    content: row.content,
    date: row.date
  };
}

function withCommentCount(tip) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE tip_id = ?').get(tip.id);
  tip.comments = c;
  return tip;
}

// 获取 Tips 列表
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tips ORDER BY id DESC').all();
  res.json({ tips: rows.map((r) => withCommentCount(serializeTip(r, req.locale))) });
});

// 发布 Tips（需登录，支持图片 base64 和 markdown 文字）
router.post('/', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  const description = String(req.body.description || '').trim();
  const image = String(req.body.image || '').trim();
  const template = req.body.template == null
    ? 'normal'
    : String(req.body.template).trim().toLowerCase();
  const tags = Array.isArray(req.body.tags)
    ? req.body.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  if (!title) {
    return res.status(400).json({ error: req.t('emptyTitle') });
  }
  if (!content) {
    return res.status(400).json({ error: req.t('emptyContent') });
  }
  if (title.length > 100) {
    return res.status(400).json({ error: req.t('titleTooLong') });
  }
  if (content.length > 20000) {
    return res.status(400).json({ error: req.t('contentTooLong') });
  }
  if (image && image.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: req.t('imageTooLarge') });
  }
  if (!['clinical', 'daily', 'normal'].includes(template)) {
    return res.status(400).json({ error: req.t('invalidTemplate') });
  }

  const username = req.user.username;
  const date = new Date().toISOString().split('T')[0];
  const avatar = (username || '匿').charAt(0);

  const info = db
    .prepare(`
      INSERT INTO tips (title, description, content, image, template_type, author_name, author_username, author_bio, author_avatar, tags, likes, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(title, description, content, image, template, username, username, '', avatar, JSON.stringify(tags), date);

  const row = db.prepare('SELECT * FROM tips WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ tip: withCommentCount(serializeTip(row, req.locale)) });
});

// 获取单个 Tip
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tips WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    return res.status(404).json({ error: req.t('tipNotFound') });
  }
  res.json({ tip: withCommentCount(serializeTip(row, req.locale)) });
});

// 获取某条 Tip 的评论
router.get('/:id/comments', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM comments WHERE tip_id = ? ORDER BY created_at DESC, id DESC')
    .all(Number(req.params.id));
  res.json({ comments: rows.map((row) => toComment(row, req.locale)) });
});

// 发表评论（未登录时为匿名）
router.post('/:id/comments', optionalAuth, (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: req.t('tipNotFound') });
  }

  const content = String(req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: req.t('emptyComment') });
  }
  if (content.length > 1000) {
    return res.status(400).json({ error: req.t('commentTooLong') });
  }

  const author = req.user ? req.user.username : '__anonymous__';
  const date = new Date().toISOString().split('T')[0];
  const info = db
    .prepare('INSERT INTO comments (tip_id, user_id, author, content, date) VALUES (?, ?, ?, ?, ?)')
    .run(tipId, req.user ? req.user.id : null, author, content, date);

  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ comment: toComment(row, req.locale) });
});

// 点赞
router.post('/:id/like', (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: req.t('tipNotFound') });
  }
  db.prepare('UPDATE tips SET likes = likes + 1 WHERE id = ?').run(tipId);
  const row = db.prepare('SELECT likes FROM tips WHERE id = ?').get(tipId);
  res.json({ likes: row.likes });
});

module.exports = router;
