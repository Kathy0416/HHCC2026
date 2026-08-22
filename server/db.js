// 数据库初始化与连接（使用 Node.js 内置的 node:sqlite，无需额外原生依赖）
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { migrateBuiltInTipKeys } = require('./builtin-tips');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const db = new DatabaseSync(DB_PATH);

// 开启外键约束
db.exec('PRAGMA foreign_keys = ON;');

// 建表
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      migraine INTEGER NOT NULL DEFAULT 0,
      diary TEXT NOT NULL DEFAULT '',
      triggers TEXT NOT NULL DEFAULT '[]',
      last_updated TEXT,
      UNIQUE(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sleep_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      sleep_time TEXT NOT NULL DEFAULT '',
      wake_time TEXT NOT NULL DEFAULT '',
      duration_hours INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      duration_total_minutes INTEGER NOT NULL DEFAULT 0,
      quality TEXT NOT NULL DEFAULT '',
      UNIQUE(user_id, date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS health_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'health_connect',
      device_name TEXT NOT NULL DEFAULT '',
      manufacturer TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      source_packages TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, provider),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS health_device_preferences (
      user_id INTEGER PRIMARY KEY,
      device_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS health_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      local_date TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      sleep_start TEXT,
      sleep_end TEXT,
      sleep_duration_minutes INTEGER,
      sleep_stages TEXT NOT NULL DEFAULT '{}',
      heart_rate_min REAL,
      heart_rate_avg REAL,
      heart_rate_max REAL,
      heart_rate_count INTEGER NOT NULL DEFAULT 0,
      spo2_min REAL,
      spo2_avg REAL,
      spo2_max REAL,
      spo2_count INTEGER NOT NULL DEFAULT 0,
      steps INTEGER,
      data_origins TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, local_date),
      FOREIGN KEY(connection_id) REFERENCES health_connections(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS health_sleep_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      source_record_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      stages TEXT NOT NULL DEFAULT '{}',
      data_origin TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, source_record_id),
      FOREIGN KEY(connection_id) REFERENCES health_connections(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS environment_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      source_record_id TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      local_date TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      mono_us INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT '',
      temperature_c REAL NOT NULL,
      humidity_pct REAL NOT NULL,
      light_lux REAL NOT NULL,
      noise_db REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, source_record_id),
      FOREIGN KEY(connection_id) REFERENCES health_connections(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      image TEXT,
      author_name TEXT NOT NULL DEFAULT '',
      author_username TEXT NOT NULL DEFAULT '',
      author_bio TEXT NOT NULL DEFAULT '',
      author_avatar TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      likes INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tip_id INTEGER NOT NULL,
      user_id INTEGER,
      author TEXT NOT NULL DEFAULT '匿名',
      content TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(tip_id) REFERENCES tips(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tip_likes (
      tip_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id, tip_id),
      FOREIGN KEY(tip_id) REFERENCES tips(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_user_date ON calendar_entries(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep_records(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_health_connections_user ON health_connections(user_id, active);
    CREATE INDEX IF NOT EXISTS idx_health_daily_user_date ON health_daily(user_id, local_date);
    CREATE INDEX IF NOT EXISTS idx_health_sleep_user_date ON health_sleep_sessions(user_id, local_date);
    CREATE INDEX IF NOT EXISTS idx_environment_user_date ON environment_readings(user_id, local_date);
    CREATE INDEX IF NOT EXISTS idx_environment_connection_time ON environment_readings(connection_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_comments_tip ON comments(tip_id);
    CREATE INDEX IF NOT EXISTS idx_tip_likes_tip ON tip_likes(tip_id);
    CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);
  `);

  // 兼容已经存在的数据库：SQLite 的 CREATE TABLE IF NOT EXISTS 不会补充新列。
  const tipColumns = db.prepare('PRAGMA table_info(tips)').all();
  if (!tipColumns.some((column) => column.name === 'template_type')) {
    db.exec("ALTER TABLE tips ADD COLUMN template_type TEXT NOT NULL DEFAULT 'normal'");
  }
  if (!tipColumns.some((column) => column.name === 'builtin_key')) {
    db.exec('ALTER TABLE tips ADD COLUMN builtin_key TEXT');
  }

  migrateBuiltInTipKeys(db);
}

// 预置 Tips 数据（仅当表为空时）
function seedTips(force = false) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM tips').get().c;
  if (count > 0 && !force) return;

  if (force) {
    db.prepare('DELETE FROM tips').run();
  }

  const tips = [
    {
      builtin_key: 'trigger_factors',
      title: '识别偏头痛触发因素',
      description: '了解常见的偏头痛触发因素，学会如何识别并记录自己的发作规律。',
      content: '偏头痛的常见触发因素包括：压力、睡眠不足或过多、饮食（酒精、咖啡因、巧克力、含硝酸盐食物）、荷尔蒙变化、环境因素（强光、噪音、天气变化）等。建议坚持记录发作时间、持续时长、当天饮食与睡眠，逐步找到属于自己的规律。',
      author_name: '神经内科李医生', author_username: 'neurologist', author_bio: '三甲医院神经内科医生', author_avatar: '李',
      tags: ['触发因素', '自我监测', '健康科普'], likes: 128, date: '2024-01-15'
    },
    {
      builtin_key: 'acute_relief',
      title: '偏头痛急性发作的缓解方法',
      description: '发作时如何第一时间缓解疼痛，这些实用技巧请收好。',
      content: '急性发作时建议：1. 到安静、黑暗的房间休息；2. 多喝水帮助代谢；3. 冷敷额头或太阳穴；4. 必要时服用医生建议的止痛药；5. 尝试深呼吸等放松技巧。如果症状严重或频率增加，请及时就医。',
      author_name: '疼痛科王主任', author_username: 'pain_specialist', author_bio: '疼痛科主任医师', author_avatar: '王',
      tags: ['缓解方法', '急性发作', '实用技巧'], likes: 96, date: '2024-02-20'
    },
    {
      builtin_key: 'sleep_migraine',
      title: '睡眠与偏头痛的关系',
      description: '规律睡眠是预防偏头痛的重要一环，学会建立健康的睡眠习惯。',
      content: '睡眠不足和睡眠过多都可能诱发偏头痛。建议保持固定的入睡和起床时间，营造舒适的睡眠环境，睡前避免咖啡因和电子屏幕。使用本应用的睡眠记录功能，观察睡眠时长与偏头痛发作之间的关联。',
      author_name: '睡眠医学科张医生', author_username: 'sleep_doctor', author_bio: '睡眠医学科医生', author_avatar: '张',
      tags: ['睡眠', '预防发作', '生活习惯'], likes: 154, date: '2024-03-10'
    },
    {
      builtin_key: 'food_diary',
      title: '偏头痛患者的饮食日记',
      description: '记录饮食可以帮助识别偏头痛触发因素，学习如何正确记录。',
      content: '饮食日记是识别偏头痛触发因素的有效工具。建议记录每天摄入的食物与饮品，尤其是巧克力、咖啡因、酒精、奶酪等常见嫌疑食物，并同时记录是否出现头痛。坚持 4-6 周后回顾，更容易发现规律。',
      author_name: '营养师黄医生', author_username: 'dietitian', author_bio: '营养师，擅长饮食记录和分析', author_avatar: '黄',
      tags: ['饮食日记', '触发因素', '自我监测'], likes: 75, date: '2024-04-05'
    },
    {
      builtin_key: 'stress_management',
      title: '压力管理与偏头痛预防',
      description: '压力是最常见的偏头痛触发因素之一，学习有效的放松技巧。',
      content: '压力是偏头痛最常见的触发因素之一。建议尝试：深呼吸练习、正念冥想、规律运动、合理安排作息、寻求社交支持。定期放松能有效降低偏头痛发作频率。',
      author_name: '心理科赵医生', author_username: 'psychologist', author_bio: '心理科医生，擅长压力管理', author_avatar: '赵',
      tags: ['压力管理', '放松技巧', '预防措施'], likes: 88, date: '2024-05-12'
    },
    {
      builtin_key: 'exercise_guide',
      title: '偏头痛患者的运动指南',
      description: '适度运动有助于预防偏头痛，但需注意方式方法。',
      content: '规律的中等强度有氧运动（如快走、游泳、骑行）有助于降低偏头痛发作频率。但应避免突然的剧烈运动，运动前充分热身，并保持充足饮水。若运动反而诱发头痛，请调整强度并咨询医生。',
      author_name: '康复科孙医生', author_username: 'rehab_doctor', author_bio: '康复科医生，擅长运动指导', author_avatar: '孙',
      tags: ['运动', '预防发作', '健康生活'], likes: 67, date: '2024-06-01'
    }
  ];

  const insert = db.prepare(`
    INSERT INTO tips (builtin_key, title, description, content, image, author_name, author_username, author_bio, author_avatar, tags, likes, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const t of tips) {
    insert.run(t.builtin_key, t.title, t.description, t.content, null, t.author_name, t.author_username, t.author_bio, t.author_avatar, JSON.stringify(t.tags), t.likes, t.date);
  }

  console.log(`✅ 已预置 ${tips.length} 条 Tips 数据`);
}

initSchema();
seedTips();

module.exports = db;
