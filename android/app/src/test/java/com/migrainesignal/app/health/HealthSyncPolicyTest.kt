package com.migrainesignal.app.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthSyncPolicyTest {
    private val signals = linkedMapOf(
        "sleep" to "read.sleep",
        "heartRate" to "read.heart",
        "oxygenSaturation" to "read.oxygen",
        "steps" to "read.steps"
    )

    @Test
    fun `permission snapshot reports partial and history combinations`() {
        val partial = HealthSyncPolicy.permissionSnapshot(
            signals,
            setOf("read.sleep", "read.steps", "read.history"),
            "read.history"
        )
        assertEquals(listOf("sleep", "steps"), partial.grantedSignals)
        assertEquals(listOf("heartRate", "oxygenSaturation"), partial.missingSignals)
        assertTrue(partial.partial)
        assertTrue(partial.historyGranted)

        val none = HealthSyncPolicy.permissionSnapshot(signals, emptySet(), "read.history")
        assertTrue(none.grantedSignals.isEmpty())
        assertFalse(none.partial)
        assertFalse(none.historyGranted)
    }

    @Test
    fun `history access controls the readable range`() {
        assertEquals(30, HealthSyncPolicy.readableDays(90, false))
        assertEquals(90, HealthSyncPolicy.readableDays(90, true))
        assertEquals(7, HealthSyncPolicy.readableDays(7, false))
        assertEquals(1, HealthSyncPolicy.readableDays(0, true))
    }

    @Test
    fun `Mi Fitness origins are first and duplicate sources are removed`() {
        assertEquals(
            listOf("com.mi.health", "com.xiaomi.wearable", "com.example.health"),
            HealthSyncPolicy.orderedOrigins(
                listOf("com.example.health", "com.xiaomi.wearable", "", "com.mi.health", "com.example.health")
            )
        )
    }
}
