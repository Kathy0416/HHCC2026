require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 业务路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/sleep', require('./routes/sleep'));
app.use('/api/tips', require('./routes/tips'));
app.use('/api/ai', require('./routes/ai'));

// 可选：同端口托管前端静态文件（需在 .env 设置 SERVE_FRONTEND=1）
if (process.env.SERVE_FRONTEND === '1') {
  const frontendDir = path.join(__dirname, '..');
  if (fs.existsSync(path.join(frontendDir, 'index.html'))) {
    app.use(express.static(frontendDir, { index: 'index.html' }));
    console.log('🌐 已开启前端静态文件托管');
  }
}

// 404
app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log('==============================================');
  console.log('  偏头痛记录日历 后端服务');
  console.log('==============================================');
  console.log(`  ➜ 服务地址:   http://localhost:${PORT}`);
  console.log(`  ➜ 健康检查:   http://localhost:${PORT}/api/health`);
  console.log(`  ➜ DeepSeek:   ${process.env.DEEPSEEK_API_KEY ? '已配置' : '未配置（AI 使用本地模拟回复）'}`);
  console.log('==============================================');
});

module.exports = app;
