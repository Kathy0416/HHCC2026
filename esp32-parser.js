(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Esp32Parser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
  const MAX_SAMPLE_LINES = 50000;

  class Esp32ParseError extends Error {
    constructor(code) {
      super(code);
      this.name = 'Esp32ParseError';
      this.code = code;
    }
  }

  function responseBytes(value) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
    return value.length;
  }

  function finiteToken(tokens, name, min, max, integer = false) {
    const raw = tokens[name];
    if (raw == null || raw === '' || raw === 'null') throw new Esp32ParseError('invalidSample');
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
      throw new Esp32ParseError('invalidSample');
    }
    return value;
  }

  function parseSampleLine(line) {
    const tokens = {};
    const tokenPattern = /([A-Za-z][A-Za-z0-9_]*)=([^\s]+)/g;
    let match;
    while ((match = tokenPattern.exec(line))) tokens[match[1]] = match[2];

    const monoUs = finiteToken(tokens, 'mono_us', 0, Number.MAX_SAFE_INTEGER, true);
    const utcMs = finiteToken(tokens, 'utc_ms', 1, Number.MAX_SAFE_INTEGER, true);
    const recordedAt = new Date(utcMs);
    if (Number.isNaN(recordedAt.getTime())) throw new Esp32ParseError('invalidSample');

    return {
      sourceRecordId: `esp32:${utcMs}:${monoUs}`,
      recordedAt: recordedAt.toISOString(),
      monoUs,
      mode: String(tokens.mode || '').slice(0, 40),
      temperatureC: finiteToken(tokens, 'temp', -50, 100),
      humidityPct: finiteToken(tokens, 'humidity', 0, 100),
      lightLux: finiteToken(tokens, 'light', 0, 1000000),
      noiseDb: finiteToken(tokens, 'noise', 0, 200)
    };
  }

  function parseEsp32Samples(raw) {
    const text = String(raw == null ? '' : raw);
    if (responseBytes(text) > MAX_RESPONSE_BYTES) throw new Esp32ParseError('responseTooLarge');

    const readings = [];
    let skipped = 0;
    let sampleLines = 0;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith('[SAMPLE]')) continue;
      sampleLines += 1;
      if (sampleLines > MAX_SAMPLE_LINES) throw new Esp32ParseError('tooManySamples');
      try {
        readings.push(parseSampleLine(line));
      } catch (error) {
        skipped += 1;
      }
    }
    if (!readings.length) throw new Esp32ParseError('noValidSamples');
    return { readings, skipped, sampleLines };
  }

  return {
    MAX_RESPONSE_BYTES,
    MAX_SAMPLE_LINES,
    Esp32ParseError,
    parseEsp32Samples,
    parseSampleLine
  };
});
