const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, requireAuth } = require('../middleware');
const db = require('../db');

const router = express.Router();

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

// 注册
router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 2 || username.length > 30) {
    return res.status(400).json({ error: '用户名长度需在 2-30 个字符之间' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '密码至少需要 4 位' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: '该用户名已被注册' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));

  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// 登录
router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// 当前登录用户信息
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json({ user: publicUser(user) });
});

module.exports = router;
