# Building the Tradebot APK

Tradebot is a [Capacitor 8](https://capacitorjs.com) app. The UI is in `www/` and Capacitor wraps it in a native Android shell with the biometric and notification plugins. The `android/` folder is **generated**, so it is not committed.

## 1. Cloud build (recommended)

The workflow `.github/workflows/build-apk.yml` runs on every push to `main`, on pull requests, on tags `v*`, and manually (**Actions → Build Android APK → Run workflow**).

| Output | Where |
|---|---|
| `Tradebot-debug.apk` | Run summary → **Artifacts → Tradebot-apk** |
| `Tradebot-release.apk` (signed) | Same artifact, only when signing secrets are set |
| GitHub Release with APKs | Created automatically when you push a tag such as `git tag v1.0.0 && git push --tags` |

`versionCode` is set from the workflow run number, and `versionName` comes from `package.json`.

### Signed release builds

A debug APK installs fine for personal use. For a release APK, create a keystore once and keep it safe. You cannot update an installed app if you lose it.

```bash
keytool -genkeypair -v -keystore tradebot.jks -alias tradebot -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 tradebot.jks > tradebot.jks.b64     # macOS: base64 -i tradebot.jks
```

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `tradebot.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `tradebot` |
| `ANDROID_KEY_PASSWORD` | key password |

## 2. Local build

Requirements: **Node 22+**, **JDK 21**, **Android SDK** (Android Studio, or command-line tools with platform 36 and build-tools).

```bash
npm install
npm run android:init     # cap add android + icons/splash + permissions + sync
npm run apk:debug        # android/app/build/outputs/apk/debug/app-debug.apk
# or open in Android Studio
npm run android:open
```

After changing anything in `www/`, run `npm run android:sync` before building again.

Install on a connected phone with USB debugging enabled:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 3. Browser preview

```bash
npm run serve   # http://localhost:8080
```

Everything works in Paper mode. Fingerprint is simulated, and secrets go to `localStorage` (preview only). MetaApi calls from a desktop browser can be blocked by CORS. In the APK they go through the native `CapacitorHttp` layer, which isn't subject to CORS.

## Version & changelog in the app

`scripts/gen-version.mjs` runs before every sync and build. It writes `www/js/version.js` with the version (from `package.json`), the build number (CI run number), the commit, the build date and the full `CHANGELOG.md`. These appear under **Profile → About** and **What's new**.

For each release: bump `version` in `package.json` and add a section at the top of `CHANGELOG.md`.

## What `scripts/patch-android.mjs` does

- Adds `INTERNET`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `POST_NOTIFICATIONS` and `WAKE_LOCK` permissions
- Locks the main activity to portrait
- Sets `versionCode` and `versionName`

## Signing an APK yourself (without CI secrets)

When the signing secrets are not set, each build also publishes `Tradebot-release-unsigned.apk` to the `apk` branch. Sign it locally with your key (requires `pip install cryptography`):

```bash
keytool -importkeystore -srckeystore tradebot-release.jks -destkeystore tradebot-release.p12 -deststoretype pkcs12
python3 scripts/apksign.py sign Tradebot-release-unsigned.apk Tradebot.apk tradebot-release.p12 '<password>'
python3 scripts/apksign.py verify Tradebot.apk
```

`apksign.py` implements APK Signature Scheme v2 (RSA/SHA-256), which works on Android 7+. Google's `apksigner` gives the same result.

## Why a permanent signing key matters

Without the signing secrets, each GitHub runner signs the APK with a new temporary debug key. Android then refuses to install the next build over the old one, because a changed signature looks like tampering. After you add the four secrets above, `Tradebot.apk` on the `apk` branch is always the release build signed with your key, so updates install in place.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unsupported class file major version` | Use JDK 21 (`java -version`) |
| `SDK location not found` | Set `ANDROID_HOME`, or create `android/local.properties` with `sdk.dir=…` |
| Fingerprint option greyed out | No fingerprint is enrolled on the device. Add one in Android Settings → Security |
| "App not installed" / "package conflicts" | The installed build was signed with a different key. Uninstall it once, then install the new one |
| Play Protect "Unsafe app blocked" / "Unknown app" | Expected for apps installed outside the Play Store. Tap **More details → Install anyway** |
