'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGES = new Set([7, 30, 90]);

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

function buildAnalysis({ range, endDate, wearableRows, manualRows, calendarRows }) {
  const wearable = new Map(wearableRows.map((row) => [row.local_date, row]));
  const manual = new Map(manualRows.map((row) => [row.date, row]));
  const calendar = new Map(calendarRows.map((row) => [row.date, row]));

  const series = dateSeries(endDate, range).map((date) => {
    const health = wearable.get(date);
    const sleep = manual.get(date);
    const diary = calendar.get(date);
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
      steps: finiteOrNull(health && health.steps)
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

module.exports = { DATE_RE, average, buildAnalysis, parseRange, safeJson, todayInZone };
