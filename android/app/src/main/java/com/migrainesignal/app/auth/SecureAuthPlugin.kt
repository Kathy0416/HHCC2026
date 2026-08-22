package com.migrainesignal.app.auth

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SecureAuth")
class SecureAuthPlugin : Plugin() {
    private lateinit var tokenStore: SecureTokenStore

    override fun load() {
        super.load()
        tokenStore = SecureTokenStore(context)
    }

    @PluginMethod
    fun getToken(call: PluginCall) {
        val result = JSObject()
        result.put("token", tokenStore.load().orEmpty())
        call.resolve(result)
    }

    @PluginMethod
    fun setToken(call: PluginCall) {
        tokenStore.save(call.getString("token").orEmpty())
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        tokenStore.clear()
        call.resolve()
    }
}
