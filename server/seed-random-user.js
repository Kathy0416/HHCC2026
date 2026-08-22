'use strict';

// 生成一个带随机数据的测试账户（默认 random / random1234）。
// 覆盖：日历偏头痛记录、睡眠、健康连接 + 每日健康汇总、
// 以及新方案的环境读数（environment_readings 表，供健康分析页环境图表展示）。
// 环境数据为真实随机值（Math.random），每次运行结果不同。
//
// 用法：node server/seed-random-user.js
// 可用环境变量覆盖：SEED_USER / SEED_PASS

const bcrypt = require('bcryptjs');
const db = require('./db');

const USERNAME = process.env.SEED_USER || 'random';
const PASSWORD = process.env.SEED_PASS || 'random1234';
const DAYS = 30;

const rnd = (min, max) => min + Math.random() * (max - min);
const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round1 = (n) => Math.round(n * 10) / 10;

function isoDate(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcMs(dateStr, hour) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hour, 0, 0);
}

function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function seed() {
  // 删除已存在的同名用户（外键级联删除其所有数据，脚本可重复运行）
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(USERNAME);
  if (existing) db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);

  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(USERNAME, passwordHash);
  const userId = Number(info.lastInsertRowid);

  // 健康连接（Sync 环境数据需要 connection_id；provider 固定 health_connect）
  db.prepare(
    `INSERT INTO health_connections (user_id, provider, device_name, manufacturer, model, source_packages, active, last_synced_at)
     VALUES (?, 'health_connect', 'ESP32 环境采集', 'espressif', 'ESP32', '[]', 1, ?)`
  ).run(userId, sqliteNow());
  const connectionId = Number(db.prepare('SELECT id FROM health_connections WHERE user_id = ?').get(userId).id);

  const insertCalendar = db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers, last_updated) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSleep = db.prepare('INSERT INTO sleep_records (user_id, date, sleep_time, wake_time, duration_hours, duration_minutes, duration_total_minutes, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertDaily = db.prepare(
    `INSERT INTO health_daily (connection_id, user_id, local_date, timezone, heart_rate_min, heart_rate_avg, heart_rate_max, heart_rate_count, spo2_min, spo2_avg, spo2_max, spo2_count, steps, data_origins)
     VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertEnv = db.prepare(
    `INSERT INTO environment_readings (connection_id, user_id, source_record_id, recorded_at, local_date, timezone, mono_us, mode, temperature_c, humidity_pct, light_lux, noise_db, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Asia/Shanghai', ?, 'NORMAL', ?, ?, ?, ?, datetime('now'))`
  );

  const now = new Date().toISOString();
  const qualities = ['excellent', 'good', 'fair', 'poor'];
  const triggerPool = ['stress', 'lack_of_sleep', 'caffeine', 'bright_light', 'noise'];
  const nowMs = Date.now();
  let envCount = 0;
  let migraineCount = 0;

  for (let i = -DAYS + 1; i <= 0; i += 1) {
    const date = isoDate(i);
    const migraine = Math.random() < 0.32 ? 1 : 0;
    if (migraine) migraineCount += 1;

    // 睡眠：时长 5.5~9.2 小时，入睡 22:00~23:30
    const totalMin = Math.round(rnd(5.5, 9.2) * 60);
    const startMin = rndInt(22 * 60, 23 * 60 + 30);
    const wakeMin = (startMin + totalMin) % 1440;
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    insertSleep.run(userId, date, hhmm(startMin), hhmm(wakeMin), Math.floor(totalMin / 60), totalMin % 60, totalMin, pick(qualities));

    // 每日健康汇总（心率 / 血氧 / 步数）
    const bpm = rndInt(58, 92);
    const spo2 = round1(rnd(95, 99.8));
    const steps = rndInt(3000, 14000);
    insertDaily.run(connectionId, userId, date, bpm - 8, bpm, bpm + rndInt(15, 30), 120, Math.max(90, round1(spo2 - 2)), spo2, Math.min(100, round1(spo2 + 1)), 40, steps, JSON.stringify([]));

    // 日历记录
    const diary = migraine
      ? '今天偏头痛发作，右侧搏动性疼痛，伴随畏光和恶心，休息后有所缓解。'
      : '今天状态良好，无偏头痛发作，工作与睡眠正常。';
    const triggers = migraine
      ? JSON.stringify(triggerPool.sort(() => Math.random() - 0.5).slice(0, 2))
      : JSON.stringify([]);
    insertCalendar.run(userId, date, migraine, diary, triggers, now);

    // 环境读数：每天 6 条（每 4 小时），真实随机
    for (let h = 0; h < 24; h += 4) {
      const isDay = h >= 8 && h <= 18;
      const light = isDay ? rndInt(300, 1200) : rndInt(2, 60);
      const temp = round1(rnd(20, 30));
      const hum = rndInt(38, 72);
      const noise = round1(rnd(28, 62));
      const source = `esp32-${date}-${h}`;
      const recordedAt = new Date(utcMs(date, h)).toISOString();
      insertEnv.run(connectionId, userId, source, recordedAt, date, nowMs * 1000 + envCount, temp, hum, light, noise);
      envCount += 1;
    }
  }

  console.log('==============================================');
  console.log('✅ 随机测试账户已生成');
  console.log(`   用户名: ${USERNAME}`);
  console.log(`   密码:   ${PASSWORD}`);
  console.log(`   数据: ${DAYS} 天，偏头痛 ${migraineCount} 天，环境读数 ${envCount} 条`);
  console.log('   覆盖: 日历 / 睡眠 / 每日健康汇总 / 环境读数(environment_readings)');
  console.log('==============================================');
}

seed();
