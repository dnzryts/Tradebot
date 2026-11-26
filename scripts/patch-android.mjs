// Post-`cap add android` patches: permissions, version and rotation.
// Safe to run repeatedly.
import fs from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
const gradlePath = 'android/app/build.gradle';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

let m = fs.readFileSync(manifestPath, 'utf8');
const perms = [
  'android.permission.INTERNET',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];
for (const p of perms) {
  if (!m.includes(`"${p}"`)) m = m.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
}
// Rotate with the device (fullUser respects the phone's auto-rotate / rotation-lock setting).
m = m.replace(/\s*android:screenOrientation="[^"]*"/, '');
m = m.replace('<activity', '<activity\n            android:screenOrientation="fullUser"');
fs.writeFileSync(manifestPath, m);

let g = fs.readFileSync(gradlePath, 'utf8');
const [maj, min, pat] = pkg.version.split('.').map(Number);
const code = process.env.VERSION_CODE || String(maj * 10000 + min * 100 + pat);
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
fs.writeFileSync(gradlePath, g);
// Not full screen: the app is laid out below the status bar and above the navigation bar.
// Colour the bar areas to match the app (dark) instead of the default white window.
const valuesDir = 'android/app/src/main/res/values';
fs.writeFileSync(`${valuesDir}/tradebot_colors.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="tb_window">#0B0F1A</color>\n</resources>\n`);
const stylesPath = `${valuesDir}/styles.xml`;
let st = fs.readFileSync(stylesPath, 'utf8');
if (!st.includes('@color/tb_window')) {
  st = st.replace(/(<style name="AppTheme.NoActionBar"[^>]*>)/, `$1\n        <item name="android:windowBackground">@color/tb_window</item>\n        <item name="android:statusBarColor">@color/tb_window</item>\n        <item name="android:navigationBarColor">@color/tb_window</item>`);
  fs.writeFileSync(stylesPath, st);
}

// Native helper so the web app can colour the status/navigation bar area to match its theme
// (System / Light / Dark). Registered in MainActivity before the bridge starts.
const javaDir = 'android/app/src/main/java/com/tradebot/app';
fs.writeFileSync(`${javaDir}/ThemeBarsPlugin.java`, `package com.tradebot.app;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ThemeBars")
public class ThemeBarsPlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        final String color = call.getString("color", "#0B0F1A");
        final Boolean lightIcons = call.getBoolean("light", false);
        getBridge().executeOnMainThread(() -> {
            try {
                int c = Color.parseColor(color);
                Window w = getActivity().getWindow();
                w.getDecorView().setBackgroundColor(c);
                getBridge().getWebView().setBackgroundColor(c);
                WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
                boolean light = lightIcons != null && lightIcons;
                ic.setAppearanceLightStatusBars(light);
                ic.setAppearanceLightNavigationBars(light);
                if (Build.VERSION.SDK_INT < 35) { w.setStatusBarColor(c); w.setNavigationBarColor(c); }
                call.resolve();
            } catch (Exception e) {
                call.reject("ThemeBars failed: " + e.getMessage());
            }
        });
    }

    /** Full screen: hide the status and navigation bars (swipe from an edge shows them briefly). */
    @PluginMethod
    public void fullscreen(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        getBridge().executeOnMainThread(() -> {
            try {
                Window w = getActivity().getWindow();
                WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(w, w.getDecorView());
                if (on) {
                    ic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    ic.hide(WindowInsetsCompat.Type.systemBars());
                } else {
                    ic.show(WindowInsetsCompat.Type.systemBars());
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("Fullscreen failed: " + e.getMessage());
            }
        });
    }
}
`);
fs.writeFileSync(`${javaDir}/MainActivity.java`, `package com.tradebot.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThemeBarsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

console.log(`Patched Android project → v${pkg.version} (${code})`);
