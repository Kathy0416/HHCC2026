'use strict';

// 生成测试账户（test / test1234）及模拟数据，覆盖：
// 日历偏头痛记录、睡眠、偏头痛时长、血氧、心跳、步数、手表连接 + 每日健康数据
const bcrypt = require('bcryptjs');
const db = require('./db');

const USERNAME = 'test';
const PASSWORD = 'test1234';
const DAYS = 30;

function isoDate(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// SQLite 的 datetime('now') 格式（无时区后缀，前端按 UTC 解析）
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function seed() {
  // 删除已存在的测试用户（外键级联删除其所有数据，保证脚本可重复运行）
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
  if (existing) db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);

  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(USERNAME, passwordHash);
  const userId = Number(info.lastInsertRowid);

  // 手表连接（Health Connect）
  db.prepare(`
    INSERT INTO health_connections (user_id, provider, device_name, manufacturer, model, source_packages, active, last_synced_at)
    VALUES (?, 'health_connect', ?, ?, ?, ?, 1, ?)
  `).run(userId, 'Xiaomi Band 9', 'Xiaomi', 'Band 9', JSON.stringify(['com.mi.health']), sqliteNow());
  const connectionId = Number(db.prepare('SELECT id FROM health_connections WHERE user_id = ?').get(userId).id);

  const insertCalendar = db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers, last_updated) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSleep = db.prepare('INSERT INTO sleep_records (user_id, date, sleep_time, wake_time, duration_hours, duration_minutes, duration_total_minutes, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertDuration = db.prepare('INSERT INTO migraine_duration_records (user_id, date, duration_minutes, last_updated) VALUES (?, ?, ?, ?)');
  const insertSpo2 = db.prepare('INSERT INTO spo2_records (user_id, date, spo2, last_updated) VALUES (?, ?, ?, ?)');
  const insertHeartRate = db.prepare('INSERT INTO heart_rate_records (user_id, date, bpm, last_updated) VALUES (?, ?, ?, ?)');
  const insertSteps = db.prepare('INSERT INTO steps_records (user_id, date, steps, last_updated) VALUES (?, ?, ?, ?)');
  const insertDaily = db.prepare(`
    INSERT INTO health_daily (connection_id, user_id, local_date, timezone, heart_rate_min, heart_rate_avg, heart_rate_max, heart_rate_count, spo2_min, spo2_avg, spo2_max, spo2_count, steps, data_origins)
    VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const qualities = ['excellent', 'good', 'fair', 'poor'];
  let migraineCount = 0;

  for (let i = -DAYS + 1; i <= 0; i += 1) {
    const k = i + DAYS; // 1..DAYS 的正数种子，避免负数取模
    const date = isoDate(i);
    const migraine = k % 3 === 0 ? 1 : 0; // 约每 3 天一次偏头痛

    // 睡眠：入睡 22:00/22:45/23:30，睡眠 6~8.8 小时
    const sleepMinutesTotal = 360 + ((k * 37) % 170);
    const sleepStartMinutes = 22 * 60 + (k % 3) * 45;
    const wakeMinutes = (sleepStartMinutes + sleepMinutesTotal) % 1440;
    const sleepTime = `${String(Math.floor(sleepStartMinutes / 60)).padStart(2, '0')}:${String(sleepStartMinutes % 60).padStart(2, '0')}`;
    const wakeTime = `${String(Math.floor(wakeMinutes / 60)).padStart(2, '0')}:${String(wakeMinutes % 60).padStart(2, '0')}`;
    insertSleep.run(userId, date, sleepTime, wakeTime, Math.floor(sleepMinutesTotal / 60), sleepMinutesTotal % 60, sleepMinutesTotal, qualities[k % 4]);

    // 偏头痛时长（仅偏头痛天，30~239 分钟）
    const durationMinutes = migraine ? 30 + ((k * 53) % 210) : 0;
    insertDuration.run(userId, date, durationMinutes, now);

    // 血氧 95.0 ~ 99.9
    const spo2 = Math.round((95 + ((k * 13) % 50) / 10) * 10) / 10;
    insertSpo2.run(userId, date, spo2, now);

    // 心跳 58 ~ 88
    const bpm = 58 + ((k * 17) % 31);
    insertHeartRate.run(userId, date, bpm, now);

    // 步数 3000 ~ 12499
    const steps = 3000 + ((k * 211) % 9500);
    insertSteps.run(userId, date, steps, now);

    // 手表每日数据（心率/血氧/步数；睡眠字段留空，让睡眠走手动记录）
    const heartMin = bpm - 8;
    const heartMax = bpm + 22;
    const spo2Min = Math.max(90, Math.round((spo2 - 2) * 10) / 10);
    const spo2Max = Math.min(100, Math.round((spo2 + 1) * 10) / 10);
    insertDaily.run(connectionId, userId, date, heartMin, bpm, heartMax, 120, spo2Min, spo2, spo2Max, 40, steps, JSON.stringify(['com.mi.health']));

    // 日历记录
    const diary = migraine
      ? '今天偏头痛发作，右侧搏动性疼痛，伴随畏光和恶心，休息后有所缓解。'
      : '今天状态良好，无偏头痛发作，工作与睡眠正常。';
    const triggers = migraine ? JSON.stringify(['stress', 'lack_of_sleep']) : JSON.stringify([]);
    insertCalendar.run(userId, date, migraine, diary, triggers, now);

    if (migraine) migraineCount += 1;
  }

  console.log('==============================================');
  console.log('✅ 测试账户已生成');
  console.log(`   用户名: ${USERNAME}`);
  console.log(`   密码:   ${PASSWORD}`);
  console.log(`   模拟数据: ${DAYS} 天（偏头痛 ${migraineCount} 天）`);
  console.log('   覆盖: 日历偏头痛记录 / 睡眠 / 偏头痛时长 / 血氧 / 心跳 / 步数 / 手表数据');
  console.log('==============================================');
}

seed();
