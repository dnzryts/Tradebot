/* Fingerprint / biometric lock + secure secret storage.
   Native: @capgo/capacitor-native-biometric (Android BiometricPrompt + Keystore-backed credentials).
   Browser preview: falls back to a simulated scan and localStorage. */
(function (global) {
  const SERVER = 'app.tradebot.secure';
  const plugin = () => global.Capacitor?.Plugins?.NativeBiometric;
  const isNative = () => !!(global.Capacitor?.isNativePlatform?.() && plugin());

  const Security = {
    isNative,
    async available() {
      if (!isNative()) return { ok: false, simulated: true, type: 'Fingerprint (preview)' };
      try { const r = await plugin().isAvailable(); return { ok: !!r.isAvailable, type: r.biometryType === 4 ? 'Face' : 'Fingerprint' }; }
      catch { return { ok: false }; }
    },
    /* Resolves true when the user authenticated. */
    async verify(reason = 'Unlock Tradebot') {
      if (!isNative()) { await new Promise(r => setTimeout(r, 1200)); return true; } // preview only
      try {
        await plugin().verifyIdentity({ reason, title: 'Tradebot', subtitle: reason, description: 'Use your fingerprint to continue', negativeButtonText: 'Use PIN', maxAttempts: 3 });
        return true;
      } catch { return false; }
    },
    async setSecret(name, value) {
      if (isNative()) return plugin().setCredentials({ username: name, password: value, server: `${SERVER}.${name}` });
      localStorage.setItem(`tb_secret_${name}`, value);
    },
    async getSecret(name) {
      if (isNative()) { try { return (await plugin().getCredentials({ server: `${SERVER}.${name}` })).password; } catch { return null; } }
      return localStorage.getItem(`tb_secret_${name}`);
    },
    async deleteSecret(name) {
      if (isNative()) { try { await plugin().deleteCredentials({ server: `${SERVER}.${name}` }); } catch {} return; }
      localStorage.removeItem(`tb_secret_${name}`);
    },
    async hashPin(pin) {
      const data = new TextEncoder().encode('tradebot:' + pin);
      if (crypto.subtle) { const h = await crypto.subtle.digest('SHA-256', data); return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''); }
      let h = 0; for (const b of data) h = (h * 31 + b) | 0; return 'x' + h; // insecure-context fallback (preview only)
    },
  };
  global.Security = Security;
})(window);
