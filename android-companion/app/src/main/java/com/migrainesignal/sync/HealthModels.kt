package com.migrainesignal.sync

import java.time.Instant
import java.time.LocalDate

data class TimedValue(val time: Instant, val value: Double)
data class StepInterval(val end: Instant, val count: Long)
data class SleepInput(
    val sourceRecordId: String,
    val start: Instant,
    val end: Instant,
    val stages: Map<String, Int>,
    val dataOrigin: String
)

data class MetricSummary(val min: Double, val average: Double, val max: Double, val count: Int)
data class SleepSummary(val start: Instant, val end: Instant, val durationMinutes: Int, val stages: Map<String, Int>)
data class DailySummary(
    val date: LocalDate,
    val timezone: String,
    val sleep: SleepSummary?,
    val heartRate: MetricSummary?,
    val spo2: MetricSummary?,
    val steps: Long?,
    val dataOrigins: Set<String>
)

data class SleepUploadSession(
    val sourceRecordId: String,
    val localDate: LocalDate,
    val start: Instant,
    val end: Instant,
    val durationMinutes: Int,
    val stages: Map<String, Int>,
    val dataOrigin: String
)

data class SyncBundle(
    val timezone: String,
    val days: List<DailySummary>,
    val sleepSessions: List<SleepUploadSession>,
    val dataOrigins: Set<String>
)
