'use strict';

// 生成测试账户（test / test1234）及模拟数据，覆盖：
// 日历偏头痛记录、睡眠、手表连接 + 每日健康数据、
// 逐条体征读数（心率/血氧/步数）与逐条环境读数（温湿度/光照，模拟 ESP32 上传）
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

// 由 'YYYY-MM-DD' + 小时/分钟换算为 UTC 毫秒时间戳（读数统一用 UTC 毫秒存储）
function utcMs(dateStr, hour, minute = 0) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
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

  // 登记一台演示用 ESP32 设备，供环境读数样本归属
  db.prepare('INSERT INTO hardware_devices (user_id, device_id, device_token, name) VALUES (?, ?, ?, ?)')
    .run(userId, 'DEMO-ESP32', 'demo-token-' + Math.random().toString(16).slice(2), '演示环境传感器');
  const deviceId = Number(db.prepare('SELECT id FROM hardware_devices WHERE user_id = ?').get(userId).id);

  const insertCalendar = db.prepare('INSERT INTO calendar_entries (user_id, date, migraine, diary, triggers, last_updated) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSleep = db.prepare('INSERT INTO sleep_records (user_id, date, sleep_time, wake_time, duration_hours, duration_minutes, duration_total_minutes, quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertDaily = db.prepare(`
    INSERT INTO health_daily (connection_id, user_id, local_date, timezone, heart_rate_min, heart_rate_avg, heart_rate_max, heart_rate_count, spo2_min, spo2_avg, spo2_max, spo2_count, steps, data_origins)
    VALUES (?, ?, ?, 'Asia/Shanghai', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // 逐条时间戳的体征读数（心率 / 血氧 / 步数）
  const insertVitals = db.prepare('INSERT INTO vitals_readings (user_id, source, utc_epoch_ms, heart_rate, spo2, steps) VALUES (?, ?, ?, ?, ?, ?)');
  // 模拟 ESP32 上传的环境读数（温湿度 / 光照）：先写事件，再逐条写样本
  const insertEvent = db.prepare(`INSERT INTO hardware_events (device_id, user_id, event_id, event_sequence, event_utc_ms, boot_id, time_quality, status, pre_count, active_count, sample_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertSample = db.prepare(`INSERT INTO hardware_samples (event_id, sample_index, monotonic_us, utc_epoch_ms, boot_id, sampling_mode, time_quality, light_lux, temperature_c, humidity_percent, noise_db_spl, valid_mask) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

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

    // 血氧 95.0 ~ 99.9
    const spo2 = Math.round((95 + ((k * 13) % 50) / 10) * 10) / 10;
    // 心跳 58 ~ 88
    const bpm = 58 + ((k * 17) % 31);
    // 步数 3000 ~ 12499
    const steps = 3000 + ((k * 211) % 9500);

    // 手表每日汇总（心率/血氧/步数；睡眠字段留空，让睡眠走手动记录）
    const heartMin = bpm - 8;
    const heartMax = bpm + 22;
    const spo2Min = Math.max(90, Math.round((spo2 - 2) * 10) / 10);
    const spo2Max = Math.min(100, Math.round((spo2 + 1) * 10) / 10);
    insertDaily.run(connectionId, userId, date, heartMin, bpm, heartMax, 120, spo2Min, spo2, spo2Max, 40, steps, JSON.stringify(['com.mi.health']));

    // 逐条时间戳的体征读数（每天 4 条：0 / 8 / 12 / 20 点）
    [0, 8, 12, 20].forEach((hour, index) => {
      const drift = ((k + index) % 7) - 3;
      insertVitals.run(userId, 'wearable', utcMs(date, hour), bpm + drift, Math.round((spo2 + drift / 10) * 10) / 10, Math.round(steps / 4) + index * 50);
    });

    // 模拟 ESP32 上传的环境读数（每天 4 条样本，带 UTC 时间戳）
    const eventInfo = insertEvent.run(deviceId, userId, `DEMO-${date}`, k, utcMs(date, 0), 1, 1, 1, 0, 0, 4);
    const eventPk = Number(eventInfo.lastInsertRowid);
    [0, 6, 12, 18].forEach((hour, index) => {
      const light = hour === 0 ? 5 : (hour === 6 ? 120 : (hour === 12 ? 800 : 40));
      const temp = Math.round((20 + Math.sin((k + index) / 3) * 4) * 10) / 10;
      const humidity = 45 + ((k * 7 + index * 11) % 25);
      insertSample.run(eventPk, index, utcMs(date, hour), utcMs(date, hour), 1, 1, 1, light, temp, humidity, 35, 0x07);
    });

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
  console.log('   覆盖: 日历偏头痛记录 / 睡眠 / 手表数据 / 逐条体征读数(心率·血氧·步数) / 逐条环境读数(温湿度·光照)');
  console.log('==============================================');
}

seed();
