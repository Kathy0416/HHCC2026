package com.migrainesignal.app.health

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var reader: HealthConnectReader
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>
    private var pendingPermissionCall: PluginCall? = null

    override fun load() {
        super.load()
        reader = HealthConnectReader(context)
        permissionLauncher = activity.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { granted ->
            val call = pendingPermissionCall
            pendingPermissionCall = null
            if (call != null) call.resolve(permissionResult(granted))
        }
    }

    @PluginMethod
    fun getAvailability(call: PluginCall) {
        val status = when (reader.sdkStatus()) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
            else -> "unavailable"
        }
        val result = JSObject()
        result.put("status", status)
        result.put("manufacturer", Build.MANUFACTURER.orEmpty())
        result.put("model", Build.MODEL.orEmpty())
        result.put("deviceName", Build.MODEL.ifBlank { "Android device" })
        result.put("timezone", ZoneId.systemDefault().id)
        call.resolve(result)
    }

    @PluginMethod
    fun getPermissionState(call: PluginCall) {
        if (!ensureAvailable(call)) return
        scope.launch {
            try {
                call.resolve(permissionResult(reader.grantedPermissions()))
            } catch (error: Exception) {
                call.reject(error.message ?: "Unable to read Health Connect permissions", null, error)
            }
        }
    }

    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        if (!ensureAvailable(call)) return
        if (pendingPermissionCall != null) {
            call.reject("A Health Connect permission request is already open", "BUSY")
            return
        }
        val includeHistory = call.getBoolean("includeHistory", true) ?: true
        pendingPermissionCall = call
        activity.runOnUiThread {
            try {
                permissionLauncher.launch(reader.requestedPermissions(includeHistory))
            } catch (error: Exception) {
                pendingPermissionCall = null
                call.reject(error.message ?: "Unable to request Health Connect permissions", null, error)
            }
        }
    }

    @PluginMethod
    fun discoverOrigins(call: PluginCall) {
        if (!ensureAvailable(call)) return
        val days = (call.getInt("days", 30) ?: 30).coerceIn(1, 90).toLong()
        scope.launch {
            try {
                val origins = reader.discoverOrigins(days)
                val entries = JSArray()
                origins.forEach { packageName ->
                    val item = JSObject()
                    item.put("packageName", packageName)
                    item.put("likelyMiFitness", HealthConnectReader.isLikelyMiFitness(packageName))
                    entries.put(item)
                }
                val result = JSObject()
                result.put("origins", entries)
                call.resolve(result)
            } catch (error: Exception) {
                call.reject(error.message ?: "Unable to discover Health Connect sources", null, error)
            }
        }
    }

    @PluginMethod
    fun readDailyData(call: PluginCall) {
        if (!ensureAvailable(call)) return
        val sourcePackage = call.getString("sourcePackage").orEmpty().trim()
        if (sourcePackage.isBlank()) {
            call.reject("Choose a Health Connect data source first", "SOURCE_REQUIRED")
            return
        }
        val requestedDays = (call.getInt("days", 90) ?: 90).coerceIn(1, 90)
        scope.launch {
            try {
                val granted = reader.grantedPermissions()
                val historyGranted = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY in granted
                val actualDays = HealthSyncPolicy.readableDays(requestedDays, historyGranted)
                val bundle = reader.readBundle(sourcePackage, actualDays.toLong(), ZoneId.systemDefault())
                val result = permissionResult(granted)
                result.put("requestedDays", requestedDays)
                result.put("actualDays", actualDays)
                result.put("dataOrigins", JSArray(bundle.dataOrigins.toList()))
                result.put("payload", bundleJson(bundle))
                call.resolve(result)
            } catch (error: Exception) {
                call.reject(error.message ?: "Unable to read Health Connect data", null, error)
            }
        }
    }

    @PluginMethod
    fun openHealthConnectSettings(call: PluginCall) {
        activity.runOnUiThread {
            try {
                val intent = Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                call.resolve()
            } catch (missingSettings: ActivityNotFoundException) {
                val launchIntent = context.packageManager.getLaunchIntentForPackage(HEALTH_CONNECT_PROVIDER)
                if (launchIntent == null) call.reject("Health Connect is not installed", "UNAVAILABLE", missingSettings)
                else {
                    context.startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    call.resolve()
                }
            }
        }
    }

    private fun ensureAvailable(call: PluginCall): Boolean {
        if (reader.sdkStatus() == HealthConnectClient.SDK_AVAILABLE) return true
        call.reject("Health Connect is unavailable or needs an update", "UNAVAILABLE")
        return false
    }

    private fun permissionResult(granted: Set<String>): JSObject {
        val snapshot = HealthSyncPolicy.permissionSnapshot(
            reader.signalPermissions(),
            granted,
            HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
        )
        val result = JSObject()
        result.put("granted", JSArray(snapshot.grantedSignals))
        result.put("missing", JSArray(snapshot.missingSignals))
        result.put("historyAvailable", reader.historyAvailable())
        result.put("historyGranted", snapshot.historyGranted)
        result.put("partial", snapshot.partial)
        return result
    }

    private fun bundleJson(bundle: SyncBundle): JSObject {
        val payload = JSObject()
        payload.put("timezone", bundle.timezone)
        val days = JSArray()
        bundle.days.forEach { day ->
            val json = JSONObject()
                .put("date", day.date.toString())
                .put("timezone", day.timezone)
                .put("dataOrigins", JSONArray(day.dataOrigins.toList()))
            day.sleep?.let { sleep ->
                json.put("sleep", JSONObject()
                    .put("start", sleep.start.toString())
                    .put("end", sleep.end.toString())
                    .put("durationMinutes", sleep.durationMinutes)
                    .put("stages", JSONObject(sleep.stages)))
            }
            day.heartRate?.let { json.put("heartRate", metricJson(it)) }
            day.spo2?.let { json.put("spo2", metricJson(it)) }
            day.steps?.let { json.put("steps", it) }
            days.put(JSObject.fromJSONObject(json))
        }
        payload.put("days", days)

        val sessions = JSArray()
        bundle.sleepSessions.forEach { sleep ->
            val json = JSONObject()
                .put("sourceRecordId", sleep.sourceRecordId)
                .put("localDate", sleep.localDate.toString())
                .put("start", sleep.start.toString())
                .put("end", sleep.end.toString())
                .put("durationMinutes", sleep.durationMinutes)
                .put("stages", JSONObject(sleep.stages))
                .put("dataOrigin", sleep.dataOrigin)
            sessions.put(JSObject.fromJSONObject(json))
        }
        payload.put("sleepSessions", sessions)
        return payload
    }

    private fun metricJson(metric: MetricSummary) = JSONObject()
        .put("min", metric.min)
        .put("avg", metric.average)
        .put("max", metric.max)
        .put("count", metric.count)

    private companion object {
        const val HEALTH_CONNECT_PROVIDER = "com.google.android.apps.healthdata"
    }
}
