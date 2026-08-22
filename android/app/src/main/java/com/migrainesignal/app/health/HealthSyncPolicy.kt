package com.migrainesignal.app.health

data class PermissionSnapshot(
    val grantedSignals: List<String>,
    val missingSignals: List<String>,
    val historyGranted: Boolean
) {
    val partial: Boolean = grantedSignals.isNotEmpty() && missingSignals.isNotEmpty()
}

object HealthSyncPolicy {
    fun permissionSnapshot(
        signalPermissions: Map<String, String>,
        grantedPermissions: Set<String>,
        historyPermission: String
    ): PermissionSnapshot {
        val granted = mutableListOf<String>()
        val missing = mutableListOf<String>()
        signalPermissions.forEach { (signal, permission) ->
            if (permission in grantedPermissions) granted += signal else missing += signal
        }
        return PermissionSnapshot(granted, missing, historyPermission in grantedPermissions)
    }

    fun readableDays(requestedDays: Int, historyGranted: Boolean): Int {
        val safeDays = requestedDays.coerceIn(1, 90)
        return if (historyGranted) safeDays else minOf(safeDays, 30)
    }

    fun orderedOrigins(origins: Iterable<String>): List<String> = origins
        .filter(String::isNotBlank)
        .distinct()
        .sortedWith(compareByDescending<String> { HealthConnectReader.isLikelyMiFitness(it) }.thenBy { it })
}
