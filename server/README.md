# 偏头痛记录日历 - 后端服务

基于 **Node.js + Express + SQLite** 的后端，为现有前端提供：用户认证、日历记录、睡眠记录、Health Connect 每日汇总与分析、Tips 广场、评论、以及 DeepSeek AI 代理。

- 数据库使用 Node.js 内置的 `node:sqlite`（Node ≥ 22.5，推荐 Node 24），**无需安装任何原生编译依赖**。
- 密码使用 `bcryptjs` 哈希存储，认证使用 `jsonwebtoken`（JWT）。
- DeepSeek API Key 只保存在服务端，前端不再暴露密钥。

## 目录结构

```
server/
├── server.js          # 入口：Express 应用、路由挂载、启动
├── db.js              # SQLite 连接、建表、预置 Tips 数据
├── middleware.js      # JWT 签名/校验中间件
├── routes/
│   ├── auth.js        # 注册 / 登录 / 当前用户
│   ├── calendar.js    # 日历记录 CRUD
│   ├── sleep.js       # 睡眠记录 CRUD
│   ├── health.js      # Health Connect 连接、同步与分析
│   ├── tips.js        # Tips 列表 / 评论 / 点赞
│   └── ai.js          # DeepSeek 代理 + 聊天历史
├── package.json
├── .env.example       # 环境变量模板
└── README.md
```

## 快速开始

```bash
cd server
npm install

# 复制环境变量模板并（可选）配置 DeepSeek Key
cp .env.example .env

# 启动（默认端口 3000）
npm start

# 开发模式（文件变更自动重启）
npm run dev
```

启动后访问健康检查：`http://localhost:3000/api/health`

> 说明：数据库文件 `data.db` 会在首次启动时自动创建，并预置 6 条 Tips 数据。

## 环境变量（.env）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `JWT_SECRET` | JWT 签名密钥（生产务必修改） | `dev-secret-change-me` |
| `DB_PATH` | SQLite 数据库文件路径 | `server/data.db` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（留空则 AI 使用服务端本地模拟回复） | 空 |
| `DEEPSEEK_API_URL` | DeepSeek 接口地址 | `https://api.deepseek.com/chat/completions` |
| `DEEPSEEK_MODEL` | 模型名称 | `deepseek-chat` |
| `SERVE_FRONTEND` | 设为 `1` 时后端同端口托管前端静态文件 | 关闭 |

## API 文档

所有接口前缀为 `/api`。除登录/注册外，需要携带请求头 `Authorization: Bearer <token>`。

### 认证 `/api/auth`

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/auth/register` | 注册 | `{ username, password }` | `{ token, user }` |
| POST | `/api/auth/login` | 登录 | `{ username, password }` | `{ token, user }` |
| GET | `/api/auth/me` | 当前用户（需登录） | - | `{ user }` |

### 日历 `/api/calendar`（需登录）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/calendar` | 获取全部记录 | - |
| PUT | `/api/calendar/:date` | 保存某天记录 | `{ migraine, diary, triggers }` |
| DELETE | `/api/calendar/:date` | 删除某天记录 | - |

`date` 格式为 `YYYY-MM-DD`。GET 返回 `{ entries: [...], byDate: { "2026-08-16": {...} } }`。

### 睡眠 `/api/sleep`（需登录）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/sleep` | 获取全部记录 | - |
| PUT | `/api/sleep/:date` | 保存某天记录 | `{ sleepTime, wakeTime, duration: { hours, minutes, totalMinutes }, quality }` |
| DELETE | `/api/sleep/:date` | 删除某天记录 | - |

### 健康分析 `/api/health`（需登录）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/health/connections` | 注册或重新启用 Health Connect 数据源 | `{ provider: "health_connect", deviceName?, manufacturer?, model?, sourcePackages? }` |
| GET | `/api/health/connection` | 获取连接状态与最新汇总 | - |
| DELETE | `/api/health/connections/:id` | 停用连接并保留历史 | - |
| POST | `/api/health/sync` | 幂等写入每日汇总和睡眠会话 | `{ connectionId, timezone, days, sleepSessions }` |
| GET | `/api/health/analysis?range=30` | 获取 7/30/90 天趋势、KPI、覆盖率和描述性对比 | - |

同步接口只从 JWT 读取用户身份，忽略请求体中的任何用户编号。每日数据包括睡眠、心率 min/avg/max/count、SpO₂ min/avg/max/count、步数、时区和数据来源。分析以可穿戴睡眠优先，手动睡眠记录仍单独保留。

### Tips `/api/tips`

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | `/api/tips` | Tips 列表 | - |
| POST | `/api/tips` | 发布 Tip（需登录） | `{ title, description?, content, image?, tags?, template?: "clinical" \| "daily" \| "normal" }` |
| GET | `/api/tips/:id` | 单个 Tip | - |
| GET | `/api/tips/:id/comments` | 评论列表 | - |
| POST | `/api/tips/:id/comments` | 发表评论（可选登录，匿名） | `{ content }` |
| POST | `/api/tips/:id/like` | 点赞 | - |

Tips 响应包含 `template` 字段；旧客户端省略该字段时默认使用 `normal`。

### AI `/api/ai`

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | `/api/ai/chat` | 对话（代理 DeepSeek） | `{ message, history: [{role, content}] }` |
| GET | `/api/ai/history` | 当前用户聊天历史 | - |

`chat` 返回 `{ reply, mock }`，`mock` 为 `true` 表示使用了服务端本地模拟回复（未配置 Key 或调用失败）。

## 前端接入说明

前端通过 `../api.js`（即应用根目录下的 `api.js`）与后端通信。核心逻辑：

1. 后端可用时走服务端接口，否则**自动降级为 localStorage**，原有功能不受影响。
2. 已接入的页面：`index.html`（认证 + 日历）、`script.js`（日历）、`ai-chat.js`（AI 代理）、`sleep.html`（睡眠）、`tips.html`（Tips + 评论）、`diary.html` / `my.html`（跨设备读取日历/睡眠数据）。

如需修改后端地址，在页面引入 `api.js` **之前**设置：

```html
<script>window.API_BASE_URL = 'http://你的服务器地址:3000';</script>
<script src="api.js"></script>
```

## 安全提示

- 生产环境务必修改 `JWT_SECRET` 为随机长字符串，并配置 `DEEPSEEK_API_KEY`。
- 建议为 `/api` 接口启用 HTTPS，并限制 CORS 来源。
- 数据库文件 `data.db` 不要提交到版本库（已在 `.gitignore` 中忽略）。
