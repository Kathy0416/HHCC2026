package com.migrainesignal.sync

import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private lateinit var reader: HealthConnectReader
    private lateinit var tokenStore: SecureTokenStore
    private lateinit var serverUrl: EditText
    private lateinit var username: EditText
    private lateinit var password: EditText
    private lateinit var originSpinner: Spinner
    private lateinit var status: TextView
    private lateinit var progress: ProgressBar
    private lateinit var actionButtons: List<Button>

    private val permissionLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        status.text = if (granted.isEmpty()) "Health permissions were not granted." else "Granted ${granted.size} Health Connect permissions. Find data sources next."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        reader = HealthConnectReader(this)
        tokenStore = SecureTokenStore(this)
        serverUrl = findViewById(R.id.serverUrl)
        username = findViewById(R.id.username)
        password = findViewById(R.id.password)
        originSpinner = findViewById(R.id.originSpinner)
        status = findViewById(R.id.status)
        progress = findViewById(R.id.progress)

        val preferences = getSharedPreferences("sync_settings", MODE_PRIVATE)
        serverUrl.setText(preferences.getString("server_url", "http://10.0.2.2:3000"))
        val loginButton = findViewById<Button>(R.id.loginButton)
        val permissionsButton = findViewById<Button>(R.id.permissionsButton)
        val originsButton = findViewById<Button>(R.id.originsButton)
        val syncButton = findViewById<Button>(R.id.syncButton)
        val logoutButton = findViewById<Button>(R.id.logoutButton)
        actionButtons = listOf(loginButton, permissionsButton, originsButton, syncButton, logoutButton)
        updateOrigins(emptyList())

        loginButton.setOnClickListener {
            runTask("Signing in…") {
                val url = serverUrl.text.toString().trim()
                require(url.startsWith("http://") || url.startsWith("https://")) { "Enter a complete server URL" }
                require(username.text.isNotBlank() && password.text.isNotBlank()) { "Username and password are required" }
                preferences.edit().putString("server_url", url).apply()
                api().login(username.text.toString().trim(), password.text.toString())
                "Signed in. Grant health permissions next."
            }
        }

        permissionsButton.setOnClickListener {
            when (reader.sdkStatus()) {
                HealthConnectClient.SDK_AVAILABLE -> permissionLauncher.launch(reader.requiredPermissions())
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> status.text = "Install or update Health Connect, then try again."
                else -> status.text = "Health Connect is unavailable on this Android device. Android 9 or newer with Google Play services is required."
            }
        }

        originsButton.setOnClickListener {
            runTask("Reading available Health Connect sources…") {
                ensureHealthConnect()
                val origins = reader.discoverOrigins()
                withContext(Dispatchers.Main) { updateOrigins(origins) }
                if (origins.isEmpty()) "No permitted health source was found. Enable Mi Fitness sync in Health Connect and check permissions."
                else "Found ${origins.size} source(s). Mi Fitness-like sources are listed first."
            }
        }

        syncButton.setOnClickListener {
            runTask("Aggregating and uploading up to 90 days…") {
                ensureHealthConnect()
                require(tokenStore.load() != null) { "Sign in before syncing" }
                val source = originSpinner.selectedItem?.toString().orEmpty()
                require(source.isNotBlank() && source != NO_SOURCE) { "Find and choose a Health Connect source first" }
                val granted = reader.grantedPermissions()
                val missing = reader.requiredPermissions() - granted
                val connectionId = api().createConnection(source)
                val bundle = reader.readBundle(source, 90, ZoneId.systemDefault())
                api().sync(connectionId, bundle)
                val partial = if (missing.isEmpty()) "" else " ${missing.size} permission(s) were not granted, so those signals were skipped."
                "Synced ${bundle.days.size} daily summaries and ${bundle.sleepSessions.size} sleep sessions.$partial Refresh the Health Analysis webpage to view them."
            }
        }

        logoutButton.setOnClickListener {
            tokenStore.clear()
            password.text.clear()
            status.text = "Signed out. Health Connect permissions remain under Android Settings until you revoke them."
        }

        if (tokenStore.load() != null) status.text = "Session restored. Grant permissions or find data sources to continue."
    }

    private fun api(): HealthApiClient = HealthApiClient(serverUrl.text.toString().trim(), tokenStore)

    private fun ensureHealthConnect() {
        check(reader.sdkStatus() == HealthConnectClient.SDK_AVAILABLE) { "Health Connect is unavailable or needs an update" }
    }

    private fun updateOrigins(origins: List<String>) {
        val entries = origins.ifEmpty { listOf(NO_SOURCE) }
        originSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, entries)
    }

    private fun runTask(message: String, block: suspend () -> String) {
        setBusy(true)
        status.text = message
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) { block() }
                status.text = result
            } catch (error: Exception) {
                status.text = error.message ?: error.javaClass.simpleName
            } finally {
                setBusy(false)
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        actionButtons.forEach { it.isEnabled = !busy }
    }

    private companion object {
        const val NO_SOURCE = "—"
    }
}
