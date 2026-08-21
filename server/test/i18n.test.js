const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../../locales');
const { normalizeLocale, interpolate, apiMessage } = require('../i18n');

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
