'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGES = new Set([7, 30, 90]);
const ENVIRONMENT_SESSION_LIMIT = 10000;
const ENVIRONMENT_SESSION_GAP_MS = 30000;
const POLYNOMIAL_DEGREE = 3;
const POLYNOMIAL_WINDOW_MS = 300000;
const POLYNOMIAL_MINIMUM_COVERAGE = 0.8;
const ENVIRONMENT_METRICS = [
  ['temperatureC', 'temperature_c'],
  ['humidityPct', 'humidity_pct'],
  ['lightLux', 'light_lux'],
  ['noiseDb', 'noise_db']
];

function safeJson(value, fallback) {
  try {
    return JSON.parse(value == null ? '' : value);
  } catch (error) {
    return fallback;
  }
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function parseRange(value) {
  const range = Number(value || 30);
  return RANGES.has(range) ? range : null;
}

function todayInZone(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftDate(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateSeries(endDate, range) {
  return Array.from({ length: range }, (_, index) => shiftDate(endDate, index - range + 1));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function solveCubicAtWindowEnd(timestamps, metricColumns, windowEnd) {
  const columnCount = POLYNOMIAL_DEGREE + 1;
  if (timestamps.length < columnCount || metricColumns.some((column) => column.length !== timestamps.length)) return null;

  const design = timestamps.map((timestamp) => {
    const x = (timestamp - windowEnd) / POLYNOMIAL_WINDOW_MS;
    return [1, x, x * x, x * x * x];
  });
  const transformed = metricColumns.map((column) => [...column]);

  // Householder QR keeps the least-squares solve stable without forming A^T A.
  for (let column = 0; column < columnCount; column += 1) {
    let norm = 0;
    for (let row = column; row < design.length; row += 1) norm = Math.hypot(norm, design[row][column]);
    if (!Number.isFinite(norm) || norm <= 1e-12) return null;

    const alpha = design[column][column] >= 0 ? -norm : norm;
    const vector = Array(design.length - column);
    vector[0] = design[column][column] - alpha;
    for (let row = column + 1; row < design.length; row += 1) vector[row - column] = design[row][column];
    const vectorNorm = vector.reduce((sum, value) => sum + value * value, 0);
    if (!Number.isFinite(vectorNorm) || vectorNorm <= 1e-24) return null;

    for (let target = column; target < columnCount; target += 1) {
      let projection = 0;
      for (let row = column; row < design.length; row += 1) projection += vector[row - column] * design[row][target];
      projection = 2 * projection / vectorNorm;
      for (let row = column; row < design.length; row += 1) design[row][target] -= projection * vector[row - column];
    }
    for (const values of transformed) {
      let projection = 0;
      for (let row = column; row < design.length; row += 1) projection += vector[row - column] * values[row];
      projection = 2 * projection / vectorNorm;
      for (let row = column; row < design.length; row += 1) values[row] -= projection * vector[row - column];
    }
  }

  const predictions = [];
  for (const values of transformed) {
    const coefficients = Array(columnCount).fill(0);
    for (let row = columnCount - 1; row >= 0; row -= 1) {
      let remainder = values[row];
      for (let column = row + 1; column < columnCount; column += 1) remainder -= design[row][column] * coefficients[column];
      if (!Number.isFinite(design[row][row]) || Math.abs(design[row][row]) <= 1e-12) return null;
      coefficients[row] = remainder / design[row][row];
    }
    if (!Number.isFinite(coefficients[0])) return null;
    predictions.push(coefficients[0]);
  }
  return predictions;
}

function buildEnvironmentSeries(rows) {
  const descending = rows.map((row) => ({ row, timestamp: Date.parse(row.recorded_at) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp || Number(b.row.id || 0) - Number(a.row.id || 0));
  const latestSession = [];
  for (const item of descending) {
    const newer = latestSession[latestSession.length - 1];
    if (newer && newer.timestamp - item.timestamp > ENVIRONMENT_SESSION_GAP_MS) break;
    latestSession.push(item);
    if (latestSession.length > ENVIRONMENT_SESSION_LIMIT) break;
  }

  const truncated = latestSession.length > ENVIRONMENT_SESSION_LIMIT;
  const chronological = latestSession.slice(0, ENVIRONMENT_SESSION_LIMIT).reverse();
  const smoothing = {
    method: 'local-polynomial-regression',
    degree: POLYNOMIAL_DEGREE,
    windowSeconds: POLYNOMIAL_WINDOW_MS / 1000,
    alignment: 'trailing',
    requiresFullWindow: true,
    minimumCoverage: POLYNOMIAL_MINIMUM_COVERAGE
  };
  if (!chronological.length) {
    return {
      session: null,
      smoothing,
      quality: { expectedSamplesPerWindow: null, minimumSamplesPerWindow: null, fittedSampleCount: 0, displayGapThresholdMs: null },
      readings: []
    };
  }

  const positiveIntervals = [];
  for (let index = 1; index < chronological.length; index += 1) {
    const interval = chronological[index].timestamp - chronological[index - 1].timestamp;
    if (interval > 0) positiveIntervals.push(interval);
  }
  const medianIntervalMs = median(positiveIntervals);
  const expectedSamplesPerWindow = medianIntervalMs == null
    ? null
    : Math.floor(POLYNOMIAL_WINDOW_MS / medianIntervalMs) + 1;
  const minimumSamplesPerWindow = expectedSamplesPerWindow == null
    ? null
    : Math.max(POLYNOMIAL_DEGREE + 1, Math.ceil(expectedSamplesPerWindow * POLYNOMIAL_MINIMUM_COVERAGE));

  let left = 0;
  let fittedSampleCount = 0;
  const readings = chronological.map((item, index) => {
    const windowStart = item.timestamp - POLYNOMIAL_WINDOW_MS;
    while (left < index && chronological[left].timestamp < windowStart) left += 1;
    let fitted = null;
    const hasFullWindow = item.timestamp - chronological[0].timestamp >= POLYNOMIAL_WINDOW_MS;
    if (hasFullWindow && minimumSamplesPerWindow != null) {
      const windowItems = chronological.slice(left, index + 1);
      const distinctTimestamps = new Set(windowItems.map((entry) => entry.timestamp));
      if (distinctTimestamps.size >= minimumSamplesPerWindow) {
        const predictions = solveCubicAtWindowEnd(
          windowItems.map((entry) => entry.timestamp),
          ENVIRONMENT_METRICS.map(([, databaseKey]) => windowItems.map((entry) => Number(entry.row[databaseKey]))),
          item.timestamp
        );
        if (predictions && predictions.every(Number.isFinite)) {
          fitted = Object.fromEntries(ENVIRONMENT_METRICS.map(([jsonKey], metricIndex) => [jsonKey, predictions[metricIndex]]));
          fittedSampleCount += 1;
        }
      }
    }
    return {
      recordedAt: new Date(item.timestamp).toISOString(),
      raw: Object.fromEntries(ENVIRONMENT_METRICS.map(([jsonKey, databaseKey]) => [jsonKey, Number(item.row[databaseKey])])),
      fitted
    };
  });

  return {
    session: {
      startAt: readings[0].recordedAt,
      endAt: readings[readings.length - 1].recordedAt,
      sampleCount: readings.length,
      medianIntervalMs,
      truncated,
      demo: chronological.every((item) => item.row.mode === 'DEMO')
    },
    smoothing,
    quality: {
      expectedSamplesPerWindow,
      minimumSamplesPerWindow,
      fittedSampleCount,
      displayGapThresholdMs: medianIntervalMs == null ? null : medianIntervalMs * 2.5
    },
    readings
  };
}

function metricComparison(days, field) {
  const migraine = days.filter((day) => day.migraine && Number.isFinite(day[field])).map((day) => day[field]);
  const nonMigraine = days.filter((day) => !day.migraine && Number.isFinite(day[field])).map((day) => day[field]);
  const migraineAverage = average(migraine);
  const nonMigraineAverage = average(nonMigraine);
  return {
    migraineAverage,
    nonMigraineAverage,
    difference: migraineAverage == null || nonMigraineAverage == null
      ? null
      : Number((migraineAverage - nonMigraineAverage).toFixed(2))
  };
}

function buildAnalysis({ range, endDate, wearableRows, manualRows, calendarRows, environmentRows = [] }) {
  const wearable = new Map(wearableRows.map((row) => [row.local_date, row]));
  const manual = new Map(manualRows.map((row) => [row.date, row]));
  const calendar = new Map(calendarRows.map((row) => [row.date, row]));
  const environment = new Map(environmentRows.map((row) => [row.local_date, row]));

  const series = dateSeries(endDate, range).map((date) => {
    const health = wearable.get(date);
    const sleep = manual.get(date);
    const diary = calendar.get(date);
    const surroundings = environment.get(date);
    const triggers = safeJson(diary && diary.triggers, []);
    const wearableSleep = health && health.sleep_duration_minutes != null;
    return {
      date,
      migraine: !!(diary && diary.migraine),
      hasDiaryEntry: !!diary,
      stressTrigger: triggers.includes('stress'),
      triggers,
      sleepMinutes: wearableSleep
        ? finiteOrNull(health.sleep_duration_minutes)
        : finiteOrNull(sleep && sleep.duration_total_minutes),
      sleepSource: wearableSleep ? 'wearable' : (sleep ? 'manual' : null),
      sleepStart: wearableSleep ? health.sleep_start : (sleep && sleep.sleep_time),
      sleepEnd: wearableSleep ? health.sleep_end : (sleep && sleep.wake_time),
      heartRateAvg: finiteOrNull(health && health.heart_rate_avg),
      spo2Avg: finiteOrNull(health && health.spo2_avg),
      steps: finiteOrNull(health && health.steps),
      temperatureAvg: finiteOrNull(surroundings && surroundings.temperature_avg),
      humidityAvg: finiteOrNull(surroundings && surroundings.humidity_avg),
      lightAvg: finiteOrNull(surroundings && surroundings.light_avg),
      noiseAvg: finiteOrNull(surroundings && surroundings.noise_avg)
    };
  });

  const recordedDays = series.filter((day) => (
    day.sleepMinutes != null || day.heartRateAvg != null || day.spo2Avg != null || day.steps != null
  ));
  const overlapping = recordedDays.filter((day) => day.hasDiaryEntry);
  const migraineDays = overlapping.filter((day) => day.migraine).length;
  const nonMigraineDays = overlapping.length - migraineDays;
  const insightsAvailable = overlapping.length >= 7 && migraineDays >= 2 && nonMigraineDays >= 2;
  const migraineEntries = series.filter((day) => day.migraine);

  return {
    range,
    startDate: series[0].date,
    endDate,
    series,
    kpis: {
      averageSleepMinutes: average(recordedDays.map((day) => day.sleepMinutes)),
      migraineDays: series.filter((day) => day.migraine).length,
      averageHeartRate: average(recordedDays.map((day) => day.heartRateAvg)),
      averageSpo2: average(recordedDays.map((day) => day.spo2Avg)),
      averageSteps: average(recordedDays.map((day) => day.steps))
    },
    coverage: {
      recordedDays: recordedDays.length,
      diaryDays: series.filter((day) => day.hasDiaryEntry).length,
      overlappingDays: overlapping.length,
      migraineDays,
      nonMigraineDays,
      insightsAvailable
    },
    comparisons: insightsAvailable ? {
      sleepMinutes: metricComparison(overlapping, 'sleepMinutes'),
      heartRate: metricComparison(overlapping, 'heartRateAvg'),
      spo2: metricComparison(overlapping, 'spo2Avg'),
      steps: metricComparison(overlapping, 'steps'),
      stressTriggerRate: migraineEntries.length
        ? Number((migraineEntries.filter((day) => day.stressTrigger).length / migraineEntries.length * 100).toFixed(1))
        : null
    } : null
  };
}

module.exports = {
  DATE_RE,
  ENVIRONMENT_SESSION_LIMIT,
  average,
  buildAnalysis,
  buildEnvironmentSeries,
  parseRange,
  safeJson,
  solveCubicAtWindowEnd,
  todayInZone
};
