'use strict';

// Node.js 端移植 ESP32 固件的 binary_codec（版本 1）。
// 与 esp32/MigraineLightMonitor/binary_codec.cpp 保持一致：
//   所有整数小端；浮点为 IEEE-754 float32；CRC-32(IEEE)。
// 事件文件 = header(160B) + N × sample(44B) + footer(64B)。

const EVENT_HEADER_BYTES = 160;
const SAMPLE_RECORD_BYTES = 44;
const EVENT_FOOTER_BYTES = 64;
const FORMAT_VERSION = 1;

const MAGIC_HEADER = 'MGEV';
const MAGIC_FOOTER = 'MEND';

// CRC-32 (IEEE 802.3)，多项式 0xEDB88320，初值 0xFFFFFFFF，异或输出 0xFFFFFFFF。
// 与固件 BinaryCodec::crc32 完全一致。
function crc32(bytes) {
  let state = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    state ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(state & 1);
      state = (state >>> 1) ^ (0xEDB88320 & mask);
    }
  }
  return (state ^ 0xFFFFFFFF) >>> 0;
}

function ascii(buf, start, length) {
  let end = start + length;
  while (end > start && buf[end - 1] === 0) end -= 1;
  return buf.toString('utf8', start, end);
}

function decodeHeader(buf) {
  if (buf.length < EVENT_HEADER_BYTES) throw new Error('truncated header');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== MAGIC_HEADER) throw new Error('bad header magic');
  if (buf.readUInt16LE(4) !== FORMAT_VERSION) throw new Error('unsupported format version');
  if (buf.readUInt16LE(6) !== EVENT_HEADER_BYTES) throw new Error('bad header length');
  if (buf.readUInt16LE(144) !== SAMPLE_RECORD_BYTES) throw new Error('bad sample record length');
  if (buf.readUInt32LE(156) !== crc32(buf.subarray(0, 156))) throw new Error('header CRC mismatch');

  return {
    eventId: ascii(buf, 8, 64),
    deviceId: ascii(buf, 72, 13),
    eventType: buf[85],
    timeQuality: buf[86],
    bootId: buf.readUInt32LE(88),
    eventSequence: Number(buf.readBigUInt64LE(92)),
    eventMonotonicUs: Number(buf.readBigUInt64LE(100)),
    eventUtcMs: Number(buf.readBigInt64LE(108)),
    preDurationMs: buf.readUInt32LE(116),
    activeDurationMs: buf.readUInt32LE(120),
    preIntervalMs: buf.readUInt32LE(124),
    activeIntervalMs: buf.readUInt32LE(128),
    expectedPreCount: buf.readUInt16LE(132),
    expectedActiveCount: buf.readUInt16LE(134),
    actualPreCount: buf.readUInt16LE(136),
    sensorSchemaMask: buf.readUInt16LE(138),
    randomNonce: buf.readUInt32LE(140)
  };
}

function decodeSample(buf) {
  if (buf.length !== SAMPLE_RECORD_BYTES) throw new Error('bad sample length');
  if (buf.readUInt32LE(40) !== crc32(buf.subarray(0, 40))) throw new Error('sample CRC mismatch');
  return {
    monotonicUs: Number(buf.readBigUInt64LE(0)),
    utcEpochMs: Number(buf.readBigInt64LE(8)),
    bootId: buf.readUInt32LE(16),
    lightLux: buf.readFloatLE(20),
    temperatureC: buf.readFloatLE(24),
    humidityPercent: buf.readFloatLE(28),
    noiseDbSpl: buf.readFloatLE(32),
    mode: buf[36],
    timeQuality: buf[37],
    validMask: buf[38]
  };
}

function decodeFooter(buf) {
  if (buf.length < EVENT_FOOTER_BYTES) throw new Error('truncated footer');
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== MAGIC_FOOTER) throw new Error('bad footer magic');
  if (buf.readUInt16LE(4) !== FORMAT_VERSION) throw new Error('footer format version mismatch');
  if (buf.readUInt32LE(60) !== crc32(buf.subarray(0, 60))) throw new Error('footer CRC mismatch');
  return {
    status: buf[6],
    anchorValid: buf[7] !== 0,
    preCount: buf.readUInt32LE(8),
    activeCount: buf.readUInt32LE(12),
    sampleCount: buf.readUInt32LE(16),
    payloadCrc32: buf.readUInt32LE(20),
    finalizedMonotonicUs: Number(buf.readBigUInt64LE(24)),
    finalizedUtcMs: Number(buf.readBigInt64LE(32))
  };
}

// 解析整个事件文件，返回 { header, samples, footer }。
// 校验每一条样本的 CRC；样本数为 (len - header - footer) / sample。
function decodeEvent(buffer) {
  const total = buffer.length;
  if (total < EVENT_HEADER_BYTES + EVENT_FOOTER_BYTES) throw new Error('event too small');
  const sampleBytes = total - EVENT_HEADER_BYTES - EVENT_FOOTER_BYTES;
  if (sampleBytes % SAMPLE_RECORD_BYTES !== 0) throw new Error('misaligned sample data');

  const header = decodeHeader(buffer.subarray(0, EVENT_HEADER_BYTES));
  const footer = decodeFooter(buffer.subarray(total - EVENT_FOOTER_BYTES));

  const samples = [];
  const count = sampleBytes / SAMPLE_RECORD_BYTES;
  for (let i = 0; i < count; i += 1) {
    const start = EVENT_HEADER_BYTES + i * SAMPLE_RECORD_BYTES;
    samples.push(decodeSample(buffer.subarray(start, start + SAMPLE_RECORD_BYTES)));
  }

  if (samples.length !== footer.sampleCount) {
    throw new Error(`sample count mismatch: header implies ${samples.length}, footer says ${footer.sampleCount}`);
  }

  return { header, samples, footer };
}

module.exports = {
  EVENT_HEADER_BYTES,
  SAMPLE_RECORD_BYTES,
  EVENT_FOOTER_BYTES,
  FORMAT_VERSION,
  crc32,
  decodeHeader,
  decodeSample,
  decodeFooter,
  decodeEvent
};
