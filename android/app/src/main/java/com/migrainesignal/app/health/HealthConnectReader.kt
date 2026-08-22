package com.migrainesignal.app.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import kotlin.reflect.KClass

class HealthConnectReader(private val context: Context) {
    private val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }

    fun sdkStatus(): Int = HealthConnectClient.getSdkStatus(context, HEALTH_CONNECT_PROVIDER)

    fun signalPermissions(): Map<String, String> = linkedMapOf(
        "sleep" to HealthPermission.getReadPermission(SleepSessionRecord::class),
        "heartRate" to HealthPermission.getReadPermission(HeartRateRecord::class),
        "oxygenSaturation" to HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        "steps" to HealthPermission.getReadPermission(StepsRecord::class)
    )

    fun historyAvailable(): Boolean = sdkStatus() == HealthConnectClient.SDK_AVAILABLE &&
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) ==
        HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    fun requestedPermissions(includeHistory: Boolean): Set<String> = buildSet {
        addAll(signalPermissions().values)
        if (includeHistory && historyAvailable()) add(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY)
    }

    suspend fun grantedPermissions(): Set<String> = client.permissionController.getGrantedPermissions()

    suspend fun discoverOrigins(days: Long = 30): List<String> {
        val granted = grantedPermissions()
        val filter = TimeRangeFilter.between(Instant.now().minus(Duration.ofDays(days)), Instant.now())
        val origins = linkedSetOf<String>()
        if (signalPermissions().getValue("sleep") in granted) readAll(SleepSessionRecord::class, filter).forEach { origins += it.metadata.dataOrigin.packageName }
        if (signalPermissions().getValue("heartRate") in granted) readAll(HeartRateRecord::class, filter).forEach { origins += it.metadata.dataOrigin.packageName }
        if (signalPermissions().getValue("oxygenSaturation") in granted) readAll(OxygenSaturationRecord::class, filter).forEach { origins += it.metadata.dataOrigin.packageName }
        if (signalPermissions().getValue("steps") in granted) readAll(StepsRecord::class, filter).forEach { origins += it.metadata.dataOrigin.packageName }
        return HealthSyncPolicy.orderedOrigins(origins)
    }

    suspend fun readBundle(sourcePackage: String, days: Long, zoneId: ZoneId = ZoneId.systemDefault()): SyncBundle {
        require(sourcePackage.isNotBlank()) { "Choose a Health Connect data source first" }
        val granted = grantedPermissions()
        val filter = TimeRangeFilter.between(Instant.now().minus(Duration.ofDays(days)), Instant.now())
        val origin = setOf(DataOrigin(sourcePackage))
        val sleeps = if (signalPermissions().getValue("sleep") in granted) {
            readAll(SleepSessionRecord::class, filter, origin).map { record ->
                SleepInput(
                    sourceRecordId = record.metadata.id.ifBlank { "$sourcePackage:${record.startTime}:${record.endTime}" },
                    start = record.startTime,
                    end = record.endTime,
                    stages = record.stages.groupBy { stageName(it.stage) }.mapValues { (_, stages) ->
                        stages.sumOf { Duration.between(it.startTime, it.endTime).toMinutes().toInt() }
                    },
                    dataOrigin = record.metadata.dataOrigin.packageName
                )
            }
        } else emptyList()
        val heartRates = if (signalPermissions().getValue("heartRate") in granted) {
            readAll(HeartRateRecord::class, filter, origin).flatMap { it.samples }.map { TimedValue(it.time, it.beatsPerMinute.toDouble()) }
        } else emptyList()
        val oxygen = if (signalPermissions().getValue("oxygenSaturation") in granted) {
            readAll(OxygenSaturationRecord::class, filter, origin).map { TimedValue(it.time, it.percentage.value) }
        } else emptyList()
        val steps = if (signalPermissions().getValue("steps") in granted) {
            readAll(StepsRecord::class, filter, origin).map { StepInterval(it.endTime, it.count) }
        } else emptyList()
        val bundle = DailyAggregator.aggregate(zoneId, sleeps, heartRates, oxygen, steps)
        return bundle.copy(
            days = bundle.days.map { it.copy(dataOrigins = it.dataOrigins + sourcePackage) },
            dataOrigins = setOf(sourcePackage)
        )
    }

    private suspend fun <T : androidx.health.connect.client.records.Record> readAll(
        recordType: KClass<T>,
        filter: TimeRangeFilter,
        origins: Set<DataOrigin> = emptySet()
    ): List<T> {
        val records = mutableListOf<T>()
        var pageToken: String? = null
        do {
            val response = client.readRecords(ReadRecordsRequest(
                recordType = recordType,
                timeRangeFilter = filter,
                dataOriginFilter = origins,
                pageSize = 1000,
                pageToken = pageToken
            ))
            records += response.records
            pageToken = response.pageToken
        } while (pageToken != null)
        return records
    }

    private fun stageName(stage: Int): String = when (stage) {
        SleepSessionRecord.STAGE_TYPE_AWAKE -> "awake"
        SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake_in_bed"
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_SLEEPING -> "sleeping"
        SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
        else -> "unknown"
    }

    companion object {
        private const val HEALTH_CONNECT_PROVIDER = "com.google.android.apps.healthdata"

        fun isLikelyMiFitness(packageName: String): Boolean {
            val value = packageName.lowercase()
            return value.contains("xiaomi") || value.contains("mi.health") || value.contains("wearable")
        }
    }
}
