package com.migrainesignal.sync

import java.time.Duration
import java.time.ZoneId

object DailyAggregator {
    fun aggregate(
        zoneId: ZoneId,
        sleeps: List<SleepInput>,
        heartRates: List<TimedValue>,
        oxygenSaturations: List<TimedValue>,
        steps: List<StepInterval>
    ): SyncBundle {
        val dates = linkedSetOf<java.time.LocalDate>()
        val sleepsByDate = sleeps.groupBy { it.end.atZone(zoneId).toLocalDate() }
        val heartByDate = heartRates.groupBy { it.time.atZone(zoneId).toLocalDate() }
        val oxygenByDate = oxygenSaturations.groupBy { it.time.atZone(zoneId).toLocalDate() }
        val stepsByDate = steps.groupBy { it.end.atZone(zoneId).toLocalDate() }
        dates += sleepsByDate.keys
        dates += heartByDate.keys
        dates += oxygenByDate.keys
        dates += stepsByDate.keys

        val sessions = sleeps.map { sleep ->
            SleepUploadSession(
                sourceRecordId = sleep.sourceRecordId,
                localDate = sleep.end.atZone(zoneId).toLocalDate(),
                start = sleep.start,
                end = sleep.end,
                durationMinutes = Duration.between(sleep.start, sleep.end).toMinutes().toInt().coerceIn(0, 1440),
                stages = sleep.stages,
                dataOrigin = sleep.dataOrigin
            )
        }

        val days = dates.sorted().map { date ->
            val dateSleeps = sleepsByDate[date].orEmpty()
            val primarySleep = dateSleeps.maxByOrNull { Duration.between(it.start, it.end).toMinutes() }
            val origins = dateSleeps.map { it.dataOrigin }.toMutableSet()
            val heart = heartByDate[date].orEmpty()
            val oxygen = oxygenByDate[date].orEmpty()
            val stepIntervals = stepsByDate[date].orEmpty()
            DailySummary(
                date = date,
                timezone = zoneId.id,
                sleep = primarySleep?.let {
                    SleepSummary(
                        start = it.start,
                        end = it.end,
                        durationMinutes = Duration.between(it.start, it.end).toMinutes().toInt().coerceIn(0, 1440),
                        stages = it.stages
                    )
                },
                heartRate = summarize(heart.map { it.value }),
                spo2 = summarize(oxygen.map { it.value }),
                steps = stepIntervals.takeIf { it.isNotEmpty() }?.sumOf { it.count },
                dataOrigins = origins
            )
        }
        return SyncBundle(zoneId.id, days, sessions, sleeps.map { it.dataOrigin }.toSet())
    }

    private fun summarize(values: List<Double>): MetricSummary? {
        val finite = values.filter(Double::isFinite)
        if (finite.isEmpty()) return null
        return MetricSummary(finite.min(), finite.average(), finite.max(), finite.size)
    }
}
