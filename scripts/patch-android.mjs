// Post-`cap add android` patches: permissions, version and portrait lock.
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
if (!m.includes('android:screenOrientation')) m = m.replace('<activity', '<activity\n            android:screenOrientation="portrait"');
fs.writeFileSync(manifestPath, m);

let g = fs.readFileSync(gradlePath, 'utf8');
const [maj, min, pat] = pkg.version.split('.').map(Number);
const code = process.env.VERSION_CODE || String(maj * 10000 + min * 100 + pat);
g = g.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "${pkg.version}"`);
fs.writeFileSync(gradlePath, g);
console.log(`Patched Android project → v${pkg.version} (${code})`);
