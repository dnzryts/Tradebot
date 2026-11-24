# Security

## Local protection

- **App lock**: Android `BiometricPrompt` (via `@capgo/capacitor-native-biometric`), with a 6-digit PIN fallback. The PIN is stored only as a salted SHA-256 hash.
- **Auto re-lock** after 60 s in the background.
- **Sensitive actions** (enabling live auto-trading) require a fresh biometric confirmation.
- **Secrets**: the MetaApi token is stored with `setCredentials`, which keeps it encrypted under an Android Keystore key. It is never written to plain app storage on device.
- **MT5 password**: used once to register the account with MetaApi, then cleared from the form. It is never persisted.
- **Release builds** disable WebView remote debugging (`webContentsDebuggingEnabled: false`).
- **CSP** in `index.html` restricts network calls to MetaApi (`*.agiliumtrade.ai`) and Alpha Vantage.

## What a lost or stolen phone exposes

An attacker would need your fingerprint or PIN to open the app. The token sits in the Keystore. If you lose your phone, **revoke the MetaApi token** in the MetaApi dashboard and change your MT5 password at your broker.

## Recommendations

- Use a broker account that allows **trading but not withdrawals** with the trading password.
- Give the MetaApi token the narrowest scope MetaApi allows.
- Keep **Max lot** and **daily loss limit** conservative.
- **Profile → Sign out & erase** removes all local data and the stored token.

## Reporting

Please report security issues privately to the repository owner rather than in a public issue.
