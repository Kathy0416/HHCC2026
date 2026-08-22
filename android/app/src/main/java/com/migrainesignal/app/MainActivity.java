package com.migrainesignal.app;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;
import com.migrainesignal.app.auth.SecureAuthPlugin;
import com.migrainesignal.app.health.HealthConnectPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureAuthPlugin.class);
        registerPlugin(HealthConnectPlugin.class);
        super.onCreate(savedInstanceState);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable && getBridge() != null) {
            getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
    }
}
