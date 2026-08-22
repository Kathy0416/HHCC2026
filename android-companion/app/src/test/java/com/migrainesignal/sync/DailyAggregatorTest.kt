package com.migrainesignal.sync

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class DailyAggregatorTest {
    @Test
    fun `sleep is assigned to wake date and signals are summarized`() {
        val zone = ZoneId.of("Asia/Shanghai")
        val bundle = DailyAggregator.aggregate(
            zoneId = zone,
            sleeps = listOf(SleepInput("sleep-1", Instant.parse("2026-08-20T15:00:00Z"), Instant.parse("2026-08-20T23:00:00Z"), mapOf("deep" to 90), "com.mi.health")),
            heartRates = listOf(TimedValue(Instant.parse("2026-08-20T18:00:00Z"), 58.0), TimedValue(Instant.parse("2026-08-20T19:00:00Z"), 72.0)),
            oxygenSaturations = listOf(TimedValue(Instant.parse("2026-08-20T20:00:00Z"), 97.5)),
            steps = listOf(StepInterval(Instant.parse("2026-08-20T12:00:00Z"), 3000), StepInterval(Instant.parse("2026-08-20T13:00:00Z"), 2500))
        )
        val day = bundle.days.single()
        assertEquals("2026-08-21", day.date.toString())
        assertEquals(480, day.sleep?.durationMinutes)
        assertEquals(65.0, day.heartRate?.average ?: 0.0, 0.001)
        assertEquals(5500, day.steps)
        assertEquals("2026-08-21", bundle.sleepSessions.single().localDate.toString())
    }

    @Test
    fun `missing signal families stay nullable`() {
        val bundle = DailyAggregator.aggregate(
            ZoneId.of("UTC"), emptyList(), listOf(TimedValue(Instant.parse("2026-08-22T10:00:00Z"), 64.0)), emptyList(), emptyList()
        )
        assertNotNull(bundle.days.single().heartRate)
        assertEquals(null, bundle.days.single().spo2)
        assertEquals(null, bundle.days.single().steps)
    }
}
