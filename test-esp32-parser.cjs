const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_RESPONSE_BYTES,
  MAX_SAMPLE_LINES,
  parseEsp32Samples,
  parseSampleLine
} = require('./esp32-parser');

test('parses valid sample fields independently of their order', () => {
  const utcMs = 1776816000000;
  const parsed = parseSampleLine(
    `[SAMPLE] noise=61.0 humidity=62.9 temp=24.8 utc_ms=${utcMs} light=428.3 mode=NORMAL mono_us=106183660`
  );

  assert.deepEqual(parsed, {
    sourceRecordId: `esp32:${utcMs}:106183660`,
    recordedAt: '2026-04-22T00:00:00.000Z',
    monoUs: 106183660,
    mode: 'NORMAL',
    temperatureC: 24.8,
    humidityPct: 62.9,
    lightLux: 428.3,
    noiseDb: 61
  });
});

test('ignores blank and non-sample lines and reports malformed sample rows', () => {
  const result = parseEsp32Samples([
    '',
    '[BOOT] ready',
    '[SAMPLE] mode=NORMAL mono_us=106183660 utc_ms=null light=428.3 temp=24.8 humidity=62.9 noise=61.0',
    '[SAMPLE] mode=NORMAL mono_us=111189660 utc_ms=1776816005000 light=465.8 temp=24.8 humidity=62.1 noise=60.9',
    '[SAMPLE] mode=NORMAL mono_us=111189661 utc_ms=1776816006000 light=invalid temp=24.8 humidity=62.1 noise=60.9'
  ].join('\n'));

  assert.equal(result.readings.length, 1);
  assert.equal(result.sampleLines, 3);
  assert.equal(result.skipped, 2);
  assert.equal(result.readings[0].sourceRecordId, 'esp32:1776816005000:111189660');
});

test('fails when utc_ms is null or no valid samples remain', () => {
  assert.throws(
    () => parseEsp32Samples('[SAMPLE] mode=NORMAL mono_us=106183660 utc_ms=null light=428.3 temp=24.8 humidity=62.9 noise=61.0'),
    (error) => error.code === 'noValidSamples'
  );
  assert.throws(
    () => parseEsp32Samples('[INFO] no samples available'),
    (error) => error.code === 'noValidSamples'
  );
});

test('rejects out-of-range sensor values', () => {
  const base = '[SAMPLE] mono_us=1 utc_ms=1776816000000 light=428.3 temp=24.8 humidity=62.9 noise=61.0';
  for (const invalid of [
    base.replace('temp=24.8', 'temp=101'),
    base.replace('humidity=62.9', 'humidity=-1'),
    base.replace('light=428.3', 'light=-1'),
    base.replace('noise=61.0', 'noise=201')
  ]) {
    assert.throws(() => parseSampleLine(invalid), (error) => error.code === 'invalidSample');
  }
});

test('rejects oversized responses and excessive sample counts', () => {
  assert.throws(
    () => parseEsp32Samples('x'.repeat(MAX_RESPONSE_BYTES + 1)),
    (error) => error.code === 'responseTooLarge'
  );

  const invalidSamples = `${'[SAMPLE] utc_ms=null\n'.repeat(MAX_SAMPLE_LINES + 1)}`;
  assert.throws(
    () => parseEsp32Samples(invalidSamples),
    (error) => error.code === 'tooManySamples'
  );
});
