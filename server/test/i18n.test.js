const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const catalog = require('../../locales');
const { normalizeLocale, interpolate, apiMessage } = require('../i18n');
const { migrateBuiltInTipKeys, serializeTip } = require('../builtin-tips');

test('normalizes supported browser and Accept-Language values', () => {
  assert.equal(normalizeLocale('en-US,en;q=0.9'), 'en');
  assert.equal(normalizeLocale('zh-TW,zh;q=0.9'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), 'zh-CN');
});

test('interpolates values and localizes API messages', () => {
  assert.equal(interpolate('{{count}} activities', { count: 3 }), '3 activities');
  assert.equal(apiMessage('en', 'emptyTitle'), 'Title is required.');
  assert.equal(apiMessage('zh-CN', 'emptyTitle'), '标题不能为空');
});

test('semantic UI and API catalogs have matching locale keys', () => {
  assert.deepEqual(Object.keys(catalog.keys.en).sort(), Object.keys(catalog.keys['zh-CN']).sort());
  assert.deepEqual(Object.keys(catalog.api.en).sort(), Object.keys(catalog.api['zh-CN']).sort());
});

test('every built-in Tip has complete English and Chinese content', () => {
  for (const [key, translations] of Object.entries(catalog.tips)) {
    for (const locale of ['en', 'zh-CN']) {
      assert.ok(translations[locale], `${key} is missing ${locale}`);
      for (const field of ['title', 'description', 'content', 'authorName', 'authorBio', 'tags']) {
        assert.ok(translations[locale][field], `${key}.${locale}.${field} is empty`);
      }
    }
  }
});

test('AI catalogs explicitly request and provide both languages', () => {
  assert.match(catalog.ai.en.systemPrompt, /English/);
  assert.match(catalog.ai['zh-CN'].systemPrompt, /简体中文/);
  assert.match(catalog.ai.en.sleepReply, /sleep/i);
  assert.match(catalog.ai['zh-CN'].sleepReply, /睡眠/);
});

test('built-in Tips localize while user-authored fields remain byte-for-byte unchanged', () => {
  const base = {
    id: 99,
    builtin_key: null,
    title: '保存',
    description: 'Mixed 中文 description',
    content: 'English 与中文 content',
    image: null,
    template_type: 'normal',
    author_name: '用户 User',
    author_username: 'neurologist',
    author_bio: 'Bio 简介',
    author_avatar: 'U',
    tags: JSON.stringify(['保存', 'custom-tag']),
    likes: 0,
    date: '2026-08-22',
    created_at: '2026-08-22 00:00:00'
  };
  const englishUserTip = serializeTip(base, 'en');
  const chineseUserTip = serializeTip(base, 'zh-CN');
  assert.deepEqual(englishUserTip, chineseUserTip);
  assert.equal(englishUserTip.title, base.title);
  assert.equal(englishUserTip.content, base.content);

  const builtInRow = {
    ...base,
    builtin_key: 'trigger_factors',
    author_username: 'neurologist'
  };
  assert.equal(serializeTip(builtInRow, 'en').title, catalog.tips.trigger_factors.en.title);
  assert.equal(serializeTip(builtInRow, 'zh-CN').title, catalog.tips.trigger_factors['zh-CN'].title);
});

test('built-in Tip migration uses the complete seed fingerprint and repairs false matches', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE tips (
      id INTEGER PRIMARY KEY,
      builtin_key TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      content TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_username TEXT NOT NULL,
      author_bio TEXT NOT NULL,
      date TEXT NOT NULL
    )
  `);
  const copy = catalog.tips.trigger_factors['zh-CN'];
  const insert = database.prepare(`
    INSERT INTO tips (id, builtin_key, title, description, content, author_name, author_username, author_bio, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, null, copy.title, copy.description, copy.content, copy.authorName, 'neurologist', copy.authorBio, '2024-01-15');
  insert.run(2, null, 'My own note', '', 'Do not translate me', 'neurologist', 'neurologist', '', '2026-08-22');
  insert.run(3, 'trigger_factors', 'Wrongly tagged user Tip', '', 'Original user content', 'neurologist', 'neurologist', '', '2026-08-22');

  migrateBuiltInTipKeys(database);
  assert.equal(database.prepare('SELECT builtin_key FROM tips WHERE id = 1').get().builtin_key, 'trigger_factors');
  assert.equal(database.prepare('SELECT builtin_key FROM tips WHERE id = 2').get().builtin_key, null);
  assert.equal(database.prepare('SELECT builtin_key FROM tips WHERE id = 3').get().builtin_key, null);
  database.close();
});
