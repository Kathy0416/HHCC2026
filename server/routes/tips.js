const express = require('express');
const { optionalAuth, requireAuth } = require('../middleware');
const db = require('../db');
const catalog = require('../../locales');
const { serializeTip } = require('../builtin-tips');

const router = express.Router();
const CLINICAL_REQUIRED_TAG = '医学建议';

function normalizeTags(tags, template) {
  const normalized = Array.isArray(tags)
    ? tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const uniqueTags = [...new Set(normalized)];

  if (template === 'clinical' && !uniqueTags.includes(CLINICAL_REQUIRED_TAG)) {
    uniqueTags.push(CLINICAL_REQUIRED_TAG);
  }

  return uniqueTags;
}

function toTip(row, locale = 'zh-CN') {
  const tip = serializeTip(row, locale);
  tip.likes = Number(row.like_count == null ? row.likes : row.like_count);
  tip.liked = Boolean(row.liked_by_user);
  tip.comments = Number(row.comment_count || 0);
  return tip;
}

function toComment(row) {
  return { id: row.id, author: row.author, content: row.content, date: row.date };
}

function withCommentCount(tip) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE tip_id = ?').get(tip.id);
  tip.comments = c;
  return tip;
}

function tipSelect(userId) {
  return {
    sql: `
      SELECT
        tips.*,
        tips.likes + (SELECT COUNT(*) FROM tip_likes WHERE tip_likes.tip_id = tips.id) AS like_count,
        (SELECT COUNT(*) FROM comments WHERE comments.tip_id = tips.id) AS comment_count,
        CASE WHEN ? IS NULL THEN 0 ELSE EXISTS(
          SELECT 1 FROM tip_likes
          WHERE tip_likes.tip_id = tips.id AND tip_likes.user_id = ?
        ) END AS liked_by_user
      FROM tips
    `,
    params: [userId || null, userId || null]
  };
}

function getTipLikeState(tipId, userId) {
  return db.prepare(`
    SELECT
      tips.likes + (SELECT COUNT(*) FROM tip_likes WHERE tip_likes.tip_id = tips.id) AS likes,
      EXISTS(
        SELECT 1 FROM tip_likes
        WHERE tip_likes.tip_id = tips.id AND tip_likes.user_id = ?
      ) AS liked
    FROM tips
    WHERE tips.id = ?
  `).get(userId, tipId);
}

// 获取 Tips 列表
router.get('/', optionalAuth, (req, res) => {
  const query = tipSelect(req.user && req.user.id);
  const rows = db.prepare(`${query.sql} ORDER BY tips.id DESC`).all(...query.params);
  res.json({ tips: rows.map((row) => toTip(row, req.locale)) });
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
  const tags = normalizeTags(req.body.tags, template);

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

const query = tipSelect(req.user.id);
const row = db.prepare(`${query.sql} WHERE tips.id = ?`).get(...query.params, Number(info.lastInsertRowId));
res.status(201).json({ tip: toTip(row, req.locale) });
});

// 获取单个 Tip
router.get('/:id', optionalAuth, (req, res) => {
  const query = tipSelect(req.user && req.user.id);
  const row = db.prepare(`${query.sql} WHERE tips.id = ?`).get(...query.params, Number(req.params.id));
  if (!row) {
    return res.status(404).json({ error: req.t('tipNotFound') });
  }
res.json({ tip: toTip(row, req.locale) });
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

// 点赞（重复请求保持已点赞状态，不会创建重复数据）
router.post('/:id/like', requireAuth, (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: '未找到该笔记' });
  }

  db.prepare('INSERT OR IGNORE INTO tip_likes (tip_id, user_id) VALUES (?, ?)')
    .run(tipId, req.user.id);
  const state = getTipLikeState(tipId, req.user.id);
  res.json({ tipId, liked: Boolean(state.liked), likes: Number(state.likes) });
});

// 取消点赞（重复请求保持未点赞状态）
router.delete('/:id/like', requireAuth, (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: req.t('tipNotFound') });
  }

  db.prepare('DELETE FROM tip_likes WHERE tip_id = ? AND user_id = ?')
    .run(tipId, req.user.id);
  const state = getTipLikeState(tipId, req.user.id);
  res.json({ tipId, liked: Boolean(state.liked), likes: Number(state.likes) });
});

module.exports = router;
