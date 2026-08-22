# 偏头痛记录日历 - 后端服务

基于 **Node.js + Express + SQLite** 的后端，为现有前端提供：用户认证、日历记录、睡眠记录、Tips 广场、评论、以及 DeepSeek AI 代理。

- 数据库使用 Node.js 内置的 `node:sqlite`（Node ≥ 22.5，推荐 Node 24），**无需安装任何原生编译依赖**。
- 密码使用 `bcryptjs` 哈希存储，认证使用 `jsonwebtoken`（JWT）。
- DeepSeek API Key 只保存在服务端，前端不再暴露密钥。

## 目录结构

```
server/
├── server.js          # 入口：Express 应用、路由挂载、启动
├── db.js              # SQLite 连接、建表、预置 Tips 数据
├── middleware.js      # JWT 签名/校验中间件
├── health-analysis.js # 健康分析聚合逻辑
├── seed-test-user.js  # 生成测试账户 + 演示数据（含逐条读数）
├── lib/
│   └── binary_codec.js # 解析 ESP32 上传的二进制事件
├── routes/
│   ├── auth.js        # 注册 / 登录 / 当前用户
│   ├── calendar.js    # 日历记录 CRUD
│   ├── sleep.js       # 睡眠记录 CRUD
│   ├── health.js      # 健康连接 / 同步 / 分析
│   ├── hardware.js    # ESP32 设备登记与事件上传
│   ├── readings.js    # 环境/体征读数查询与写入
│   ├── tips.js        # Tips 列表 / 评论 / 点赞
│   └── ai.js          # DeepSeek 代理 + 聊天历史
├── test/              # node:test 测试套件
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

### 读数 `/api/readings`（需登录）

逐条时间戳记录的读数，供睡眠分析页图表与调试页表格调用。

| 方法 | 路径 | 说明 | 参数/请求体 |
|------|------|------|-----------|
| GET | `/api/readings/environment` | 环境读数（温湿度/光照/噪音，来自 ESP32 上传） | `?start=<ms>&end=<ms>&limit=<n>` |
| GET | `/api/readings/vitals` | 体征读数（心率/血氧/步数） | `?start=<ms>&end=<ms>&limit=<n>` |
| POST | `/api/readings/vitals` | 批量写入体征读数 | `[ { utcEpochMs, heartRate?, spo2?, steps?, source? } ]` |

`start` / `end` 为 UTC 毫秒时间戳，用于按时间过滤。响应形如 `{ readings: [...] }`。

### 硬件 `/api/hardware`（需登录；事件上传用设备令牌）

ESP32 固件通过设备令牌上传二进制事件，环境样本逐条落库到 `hardware_samples`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/hardware/devices` | 登记设备，返回 `device_token` |
| GET | `/api/hardware/devices` | 列出当前用户设备 |
| POST | `/api/hardware/events` | 上传二进制事件（`Bearer <device_token>` + `application/octet-stream`） |
| GET | `/api/hardware/events` | 列出事件 |
| GET | `/api/hardware/events/:id/samples` | 查看某事件的样本 |

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
