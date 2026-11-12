package com.agy.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Clean native settings dialog to toggle between Local Standalone engine
 * and Remote PC Antigravity instance.
 */
public final class RemoteSettingsDialog {

    private RemoteSettingsDialog() {
    }

    public static void show(final Activity activity) {
        if (activity == null || activity.isFinishing()) {
            return;
        }

        final Context context = activity;
        RemoteConfigPrefs.init(context);

        ScrollView scrollView = new ScrollView(context);
        LinearLayout container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        int padding = dpToPx(context, 20);
        container.setPadding(padding, padding / 2, padding, padding / 2);

        // Header description
        TextView descView = new TextView(context);
        descView.setText("Connect this app to your PC/Workstation running Antigravity CLI instead of running local engine.");
        descView.setTextSize(13);
        descView.setTextColor(Color.parseColor("#9AA0A6"));
        descView.setPadding(0, 0, 0, dpToPx(context, 16));
        container.addView(descView);

        // 1. Enable Remote Mode Checkbox
        final CheckBox enableCheck = new CheckBox(context);
        enableCheck.setText("Enable Remote PC Mode");
        enableCheck.setTextSize(15);
        enableCheck.setTypeface(null, Typeface.BOLD);
        enableCheck.setTextColor(Color.WHITE);
        enableCheck.setChecked(RemoteConfigPrefs.isRemoteMode(context));
        container.addView(enableCheck);

        // Helper spacer
        addSpacer(container, context, 12);

        // 2. Host input
        TextView hostLabel = createLabel(context, "Remote PC IP / Hostname:");
        container.addView(hostLabel);

        final EditText hostInput = new EditText(context);
        hostInput.setSingleLine(true);
        hostInput.setText(RemoteConfigPrefs.getRemoteHost(context));
        hostInput.setHint("e.g. 192.168.1.15 or mypc.tailscale.net");
        hostInput.setTextColor(Color.WHITE);
        hostInput.setHintTextColor(Color.GRAY);
        container.addView(hostInput);

        addSpacer(container, context, 10);

        // 3. Port input
        TextView portLabel = createLabel(context, "Port:");
        container.addView(portLabel);

        final EditText portInput = new EditText(context);
        portInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        portInput.setText(String.valueOf(RemoteConfigPrefs.getRemotePort(context)));
        portInput.setHint("e.g. 8080 or 45157");
        portInput.setTextColor(Color.WHITE);
        portInput.setHintTextColor(Color.GRAY);
        container.addView(portInput);

        addSpacer(container, context, 10);

        // 4. HTTPS toggle
        final CheckBox httpsCheck = new CheckBox(context);
        httpsCheck.setText("Use HTTPS (SSL/TLS)");
        httpsCheck.setTextSize(14);
        httpsCheck.setTextColor(Color.WHITE);
        httpsCheck.setChecked(RemoteConfigPrefs.isHttps(context));
        container.addView(httpsCheck);

        addSpacer(container, context, 10);

        // 5. CSRF Token input (optional)
        TextView csrfLabel = createLabel(context, "CSRF Token (Optional):");
        container.addView(csrfLabel);

        final EditText csrfInput = new EditText(context);
        csrfInput.setSingleLine(true);
        csrfInput.setText(RemoteConfigPrefs.getCsrfToken(context));
        csrfInput.setHint("Leave blank if none");
        csrfInput.setTextColor(Color.WHITE);
        csrfInput.setHintTextColor(Color.GRAY);
        container.addView(csrfInput);

        addSpacer(container, context, 16);

        // 6. Test Ping Button
        Button testBtn = new Button(context);
        testBtn.setText("⚡ Test Connection Ping");
        testBtn.setTextSize(13);
        testBtn.setBackgroundColor(Color.parseColor("#303134"));
        testBtn.setTextColor(Color.parseColor("#8AB4F8"));
        testBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                final String host = hostInput.getText().toString().trim();
                String portStr = portInput.getText().toString().trim();
                final int port = portStr.isEmpty() ? 8080 : Integer.parseInt(portStr);
                final boolean useHttps = httpsCheck.isChecked();
                final String targetUrl = (useHttps ? "https://" : "http://") + host + ":" + port + "/";

                Toast.makeText(context, "Pinging " + targetUrl + " ...", Toast.LENGTH_SHORT).show();

                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        boolean ok = false;
                        String msg = "";
                        try {
                            URL u = new URL(targetUrl);
                            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            conn.setRequestMethod("GET");
                            int code = conn.getResponseCode();
                            ok = (code > 0);
                            msg = "Server responded: HTTP " + code;
                            conn.disconnect();
                        } catch (Exception e) {
                            msg = "Ping error: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
                        }

                        final boolean success = ok;
                        final String resMsg = msg;
                        new Handler(Looper.getMainLooper()).post(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(context, (success ? "✅ " : "❌ ") + resMsg, Toast.LENGTH_LONG).show();
                            }
                        });
                    }
                }).start();
            }
        });
        container.addView(testBtn);

        scrollView.addView(container);

        AlertDialog.Builder builder = new AlertDialog.Builder(context, AlertDialog.THEME_DEVICE_DEFAULT_DARK);
        builder.setTitle("Antigravity Server Settings");
        builder.setView(scrollView);
        builder.setPositiveButton("Save & Apply", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                boolean enabled = enableCheck.isChecked();
                String host = hostInput.getText().toString().trim();
                String portStr = portInput.getText().toString().trim();
                int port = portStr.isEmpty() ? 8080 : Integer.parseInt(portStr);
                boolean https = httpsCheck.isChecked();
                String csrf = csrfInput.getText().toString().trim();

                RemoteConfigPrefs.setRemoteMode(context, enabled);
                RemoteConfigPrefs.setRemoteHost(context, host);
                RemoteConfigPrefs.setRemotePort(context, port);
                RemoteConfigPrefs.setHttps(context, https);
                RemoteConfigPrefs.setCsrfToken(context, csrf);

                Toast.makeText(context, enabled ? "Switched to Remote Mode! Reloading..." : "Switched to Local Mode! Reloading...", Toast.LENGTH_SHORT).show();

                // Restart activity to apply cleanly
                Intent intent = activity.getIntent();
                activity.finish();
                activity.startActivity(intent);
            }
        });
        builder.setNegativeButton("Cancel", null);
        builder.show();
    }

    private static TextView createLabel(Context context, String text) {
        TextView tv = new TextView(context);
        tv.setText(text);
        tv.setTextSize(13);
        tv.setTextColor(Color.parseColor("#C4C7C5"));
        return tv;
    }

    private static void addSpacer(LinearLayout parent, Context context, int dp) {
        View v = new View(context);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dpToPx(context, dp));
        v.setLayoutParams(lp);
        parent.addView(v);
    }

    private static int dpToPx(Context context, int dp) {
        float density = context.getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
}
