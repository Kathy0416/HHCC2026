const express = require('express');
const { optionalAuth } = require('../middleware');
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
