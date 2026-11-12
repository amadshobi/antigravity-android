package com.agy.remote;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Manages configuration preferences for connecting to a remote Antigravity instance.
 */
public final class RemoteConfigPrefs {

    private static final String PREF_NAME = "agy_remote_prefs";
    private static final String KEY_ENABLED = "remote_mode_enabled";
    private static final String KEY_HOST = "remote_host";
    private static final String KEY_PORT = "remote_port";
    private static final String KEY_HTTPS = "remote_https";
    private static final String KEY_CSRF = "remote_csrf";

    public static final String DEFAULT_HOST = "192.168.1.100";
    public static final int DEFAULT_PORT = 8080;

    // In-memory cached values for fast zero-overhead checks in hot paths
    private static volatile boolean sInitialized = false;
    private static volatile boolean sRemoteMode = false;
    private static volatile String sRemoteHost = DEFAULT_HOST;
    private static volatile int sRemotePort = DEFAULT_PORT;
    private static volatile boolean sIsHttps = false;
    private static volatile String sCsrfToken = "";

    private RemoteConfigPrefs() {
    }

    public static synchronized void init(Context context) {
        if (context == null) {
            return;
        }
        SharedPreferences sp = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        sRemoteMode = sp.getBoolean(KEY_ENABLED, false);
        sRemoteHost = sp.getString(KEY_HOST, DEFAULT_HOST);
        sRemotePort = sp.getInt(KEY_PORT, DEFAULT_PORT);
        sIsHttps = sp.getBoolean(KEY_HTTPS, false);
        sCsrfToken = sp.getString(KEY_CSRF, "");
        sInitialized = true;
    }

    public static boolean isRemoteMode(Context context) {
        if (!sInitialized && context != null) {
            init(context);
        }
        return sRemoteMode;
    }

    public static boolean isRemoteMode() {
        return sRemoteMode;
    }

    public static void setRemoteMode(Context context, boolean enabled) {
        sRemoteMode = enabled;
        if (context != null) {
            SharedPreferences.Editor ed = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit();
            ed.putBoolean(KEY_ENABLED, enabled);
            ed.apply();
        }
    }

    public static String getRemoteHost(Context context) {
        if (!sInitialized && context != null) {
            init(context);
        }
        return sRemoteHost;
    }

    public static String getActiveRemoteHost() {
        return sRemoteHost;
    }

    public static void setRemoteHost(Context context, String host) {
        String clean = host != null ? host.trim() : DEFAULT_HOST;
        sRemoteHost = clean;
        if (context != null) {
            SharedPreferences.Editor ed = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit();
            ed.putString(KEY_HOST, clean);
            ed.apply();
        }
    }

    public static int getRemotePort(Context context) {
        if (!sInitialized && context != null) {
            init(context);
        }
        return sRemotePort;
    }

    public static int getActiveRemotePort() {
        return sRemotePort;
    }

    public static void setRemotePort(Context context, int port) {
        sRemotePort = port > 0 ? port : DEFAULT_PORT;
        if (context != null) {
            SharedPreferences.Editor ed = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit();
            ed.putInt(KEY_PORT, sRemotePort);
            ed.apply();
        }
    }

    public static boolean isHttps(Context context) {
        if (!sInitialized && context != null) {
            init(context);
        }
        return sIsHttps;
    }

    public static boolean isHttps() {
        return sIsHttps;
    }

    public static void setHttps(Context context, boolean https) {
        sIsHttps = https;
        if (context != null) {
            SharedPreferences.Editor ed = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit();
            ed.putBoolean(KEY_HTTPS, https);
            ed.apply();
        }
    }

    public static String getCsrfToken(Context context) {
        if (!sInitialized && context != null) {
            init(context);
        }
        return sCsrfToken;
    }

    public static String getActiveCsrfToken() {
        return sCsrfToken;
    }

    public static void setCsrfToken(Context context, String csrf) {
        String clean = csrf != null ? csrf.trim() : "";
        sCsrfToken = clean;
        if (context != null) {
            SharedPreferences.Editor ed = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE).edit();
            ed.putString(KEY_CSRF, clean);
            ed.apply();
        }
    }

    public static String getBaseUrl(Context context) {
        String scheme = isHttps(context) ? "https://" : "http://";
        return scheme + getRemoteHost(context) + ":" + getRemotePort(context);
    }

    public static String getOriginUrl(Context context) {
        return getBaseUrl(context) + "/";
    }
}
