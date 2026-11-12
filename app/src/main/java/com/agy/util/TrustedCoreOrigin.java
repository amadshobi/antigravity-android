package com.agy.util;

import android.net.Uri;

import com.agy.remote.RemoteConfigPrefs;

/**
 * Exact origin for the core UI; validates loopback or configured remote host.
 */
public final class TrustedCoreOrigin {

    private TrustedCoreOrigin() {
    }

    public static boolean matches(Uri uri, int expectedPort) {
        if (uri == null || uri.getUserInfo() != null) {
            return false;
        }
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) {
            return false;
        }
        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            return false;
        }

        // 1. Loopback origin (Local mode)
        if ("127.0.0.1".equals(host) || "localhost".equalsIgnoreCase(host)) {
            return uri.getPort() == expectedPort;
        }

        // 2. Remote PC origin (Remote mode)
        if (RemoteConfigPrefs.isRemoteMode()) {
            String remoteHost = RemoteConfigPrefs.getActiveRemoteHost();
            int remotePort = RemoteConfigPrefs.getActiveRemotePort();
            if (remoteHost != null && remoteHost.equalsIgnoreCase(host)) {
                int port = uri.getPort();
                return (port == remotePort)
                        || (port == -1 && (("http".equalsIgnoreCase(scheme) && remotePort == 80)
                                         || ("https".equalsIgnoreCase(scheme) && remotePort == 443)));
            }
        }

        return false;
    }
}
