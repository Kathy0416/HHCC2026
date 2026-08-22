package com.migrainesignal.sync

import android.os.Build
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

class HealthApiClient(private val baseUrl: String, private val tokenStore: SecureTokenStore) {
    fun login(username: String, password: String): String {
        val response = request("POST", "/api/auth/login", JSONObject().put("username", username).put("password", password), authenticated = false)
        val token = response.getString("token")
        tokenStore.save(token)
        return token
    }

    fun createConnection(sourcePackage: String): Long {
        val body = JSONObject()
            .put("provider", "health_connect")
            .put("deviceName", Build.MODEL ?: "Android device")
            .put("manufacturer", Build.MANUFACTURER ?: "")
            .put("model", Build.MODEL ?: "")
            .put("sourcePackages", JSONArray().put(sourcePackage))
        return request("POST", "/api/health/connections", body).getJSONObject("connection").getLong("id")
    }

    fun sync(connectionId: Long, bundle: SyncBundle) {
        val days = JSONArray()
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
            days.put(json)
        }
        val sessions = JSONArray()
        bundle.sleepSessions.forEach { sleep ->
            sessions.put(JSONObject()
                .put("sourceRecordId", sleep.sourceRecordId)
                .put("localDate", sleep.localDate.toString())
                .put("start", sleep.start.toString())
                .put("end", sleep.end.toString())
                .put("durationMinutes", sleep.durationMinutes)
                .put("stages", JSONObject(sleep.stages))
                .put("dataOrigin", sleep.dataOrigin))
        }
        request("POST", "/api/health/sync", JSONObject()
            .put("connectionId", connectionId)
            .put("timezone", bundle.timezone)
            .put("days", days)
            .put("sleepSessions", sessions))
    }

    private fun metricJson(metric: MetricSummary) = JSONObject()
        .put("min", metric.min)
        .put("avg", metric.average)
        .put("max", metric.max)
        .put("count", metric.count)

    private fun request(method: String, path: String, body: JSONObject?, authenticated: Boolean = true): JSONObject {
        val endpoint = baseUrl.trim().trimEnd('/') + path
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 30_000
        connection.setRequestProperty("Content-Type", "application/json")
        connection.setRequestProperty("Accept", "application/json")
        if (authenticated) {
            val token = tokenStore.load() ?: throw ApiException(401, "Sign in before syncing")
            connection.setRequestProperty("Authorization", "Bearer $token")
        }
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.bufferedWriter(Charsets.UTF_8).use { it.write(body.toString()) }
        }
        val status = connection.responseCode
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val raw = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
        val response = if (raw.isBlank()) JSONObject() else JSONObject(raw)
        connection.disconnect()
        if (status !in 200..299) throw ApiException(status, response.optString("error", "Request failed ($status)"))
        return response
    }
}

class ApiException(val status: Int, override val message: String) : Exception(message)
