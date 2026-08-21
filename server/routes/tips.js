const express = require('express');
const { optionalAuth, requireAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();

function toTip(row) {
  let tags = [];
  try {
    tags = JSON.parse(row.tags || '[]');
  } catch (e) {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    image: row.image,
    template: row.template_type || 'normal',
    author: {
      name: row.author_name,
      username: row.author_username,
      bio: row.author_bio,
      avatar: row.author_avatar
    },
    tags,
    likes: row.likes,
    comments: 0,
    date: row.date,
    createdAt: row.created_at
  };
}

function toComment(row) {
  return { id: row.id, author: row.author, content: row.content, date: row.date };
}

function withCommentCount(tip) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE tip_id = ?').get(tip.id);
  tip.comments = c;
  return tip;
}

// 获取 Tips 列表
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM tips ORDER BY id DESC').all();
  res.json({ tips: rows.map((r) => withCommentCount(toTip(r))) });
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
    return res.status(400).json({ error: '标题不能为空' });
  }
  if (!content) {
    return res.status(400).json({ error: '内容不能为空' });
  }
  if (title.length > 100) {
    return res.status(400).json({ error: '标题过长（最多 100 字）' });
  }
  if (content.length > 20000) {
    return res.status(400).json({ error: '内容过长（最多 20000 字）' });
  }
  if (image && image.length > 10 * 1024 * 1024) {
    return res.status(400).json({ error: '图片过大（最大约 7MB）' });
  }
  if (!['clinical', 'daily', 'normal'].includes(template)) {
    return res.status(400).json({ error: '模板类型无效' });
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
  res.status(201).json({ tip: withCommentCount(toTip(row)) });
});

// 获取单个 Tip
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tips WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    return res.status(404).json({ error: '未找到该笔记' });
  }
  res.json({ tip: withCommentCount(toTip(row)) });
});

// 获取某条 Tip 的评论
router.get('/:id/comments', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM comments WHERE tip_id = ? ORDER BY created_at DESC, id DESC')
    .all(Number(req.params.id));
  res.json({ comments: rows.map(toComment) });
});

// 发表评论（未登录时为匿名）
router.post('/:id/comments', optionalAuth, (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: '未找到该笔记' });
  }

  const content = String(req.body.content || '').trim();
  if (!content) {
    return res.status(400).json({ error: '评论内容不能为空' });
  }
  if (content.length > 1000) {
    return res.status(400).json({ error: '评论内容过长' });
  }

  const author = req.user ? req.user.username : '匿名';
  const date = new Date().toISOString().split('T')[0];
  const info = db
    .prepare('INSERT INTO comments (tip_id, user_id, author, content, date) VALUES (?, ?, ?, ?, ?)')
    .run(tipId, req.user ? req.user.id : null, author, content, date);

  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(Number(info.lastInsertRowid));
  res.status(201).json({ comment: toComment(row) });
});

// 点赞
router.post('/:id/like', (req, res) => {
  const tipId = Number(req.params.id);
  const tip = db.prepare('SELECT id FROM tips WHERE id = ?').get(tipId);
  if (!tip) {
    return res.status(404).json({ error: '未找到该笔记' });
  }
  db.prepare('UPDATE tips SET likes = likes + 1 WHERE id = ?').run(tipId);
  const row = db.prepare('SELECT likes FROM tips WHERE id = ?').get(tipId);
  res.json({ likes: row.likes });
});

module.exports = router;
