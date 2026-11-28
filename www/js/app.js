/* Tradebot — main application (screens, state, auto-trader). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');

  /* ---------------- Persistent store ---------------- */
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('tb_' + k)); } catch { return null; } },
    set(k, v) { localStorage.setItem('tb_' + k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem('tb_' + k); },
  };

  const RISK_PRESETS = {
    // Tuned in v1.8.0 by replaying the bot over 16 months of real MT5 M1 bars (EURUSD, XAUUSD, US500).
    // The old presets (tight 1.5–2 ATR stops) lost: spread ate most trades. See docs/STRATEGY.md.
    conservative: { label: 'Conservative', riskPct: 0.5, threshold: 25, minConfidence: 80, maxPositions: 2, dailyLossPct: 2, slAtr: 4, tpAtr: 7, timeframe: '1h', htfFilter: true, exitOnFlip: true, trailing: true },
    balanced:     { label: 'Balanced',     riskPct: 1,   threshold: 25, minConfidence: 80, maxPositions: 3, dailyLossPct: 4, slAtr: 4, tpAtr: 7, timeframe: '15m', htfFilter: true, exitOnFlip: true, trailing: true },
    aggressive:   { label: 'Aggressive',   riskPct: 2,   threshold: 20, minConfidence: 75, maxPositions: 5, dailyLossPct: 8, slAtr: 3.5, tpAtr: 6, timeframe: '15m', htfFilter: true, exitOnFlip: true, trailing: true },
  };
  /* Trading experience: how much of Auto-Trade is shown. Beginners only get tested presets. */
  const LEVELS = {
    beginner: { label: 'Beginner', icon: '🌱', desc: 'Guided setup. Only the tested Conservative and Balanced presets; the bot chooses strategy, stops and sizing for you.' },
    moderate: { label: 'Moderate', icon: '📊', desc: 'Choose strategy, symbols, timeframe, $ targets and money management. Fine-tuning sliders stay hidden.' },
    pro: { label: 'Pro trader', icon: '🎯', desc: 'Every setting: entry threshold, confidence, ATR multiples, 5-minute charts and scan interval.' },
  };
  const TESTED_KEYS = ['timeframe', 'threshold', 'minConfidence', 'slAtr', 'tpAtr', 'htfFilter', 'exitOnFlip', 'trailing'];
  const HTF = { '5m': '1h', '15m': '1h', '1h': '4h', '4h': '1d' };
  const TF_MS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
  const FLIP_MIN_BARS = 4, FLIP_MULT = 1.5, SPREAD_MAX = 0.1, TRAIL_R = 1, BE_R = 0.5;
  const DEFAULT_BOT = { enabled: false, symbols: ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD'], timeframe: '15m', strategy: 'auto', targetMode: 'atr', tpUsd: 3, slUsd: 3, basketTp: 0, basketSl: 0, maxLot: 1, exitOnFlip: true, intervalSec: 10, newsPause: true, protectMode: 'standard', keepPct: 0.9, keepFrom: 'prog', progSpeed: 0.5, ...RISK_PRESETS.balanced, profile: 'balanced', botV: 2 };
  const THEMES = { midnight: ['#0b0f1a', '#6c8cff', '#9b6cff'], aurora: ['#04131a', '#19e3c3', '#4f9dff'], gold: ['#0e0c08', '#f2c14e', '#f08a4b'], light: ['#f3f5fb', '#4f6bff', '#8b5cf6'] };
  const AVATAR_COLORS = ['#6c8cff', '#19e3c3', '#f2c14e', '#ff5c7a', '#9b6cff', '#22d3a0'];

  // 1.18: Progressive becomes the Keep % default (settings saved by 1.17.2 hold keepFrom 'entry')
  /* Progressive: keep % = speed × (profit in R), capped at the chosen maximum. Speeds and their backtest
     (Balanced, Jun 25–May 26 / Jan–May 25): Slower 0.35 → +26R / +23R, Normal 0.5 → +33R / +14R, Faster 0.65 → +30R / +5R. */
  const PROG_SPEEDS = [[.35, 'Slower', '+26R / +23R'], [.5, 'Normal', '+33R / +14R'], [.65, 'Faster', '+30R / +5R']];
  const progSlope = () => S.bot.progSpeed || .5;
  const keepShare = (gainR, cap) => Math.max(0, Math.min(cap, progSlope() * gainR));
  const level = () => S.profile?.level || 'pro';
  const atLeast = l => ['beginner', 'moderate', 'pro'].indexOf(level()) >= ['beginner', 'moderate', 'pro'].indexOf(l);
  /* Which tested preset the bot's strategy settings match (null = custom), and what differs. */
  function testedState() {
    const b = S.bot, near = (x, y) => typeof y === 'number' ? Math.abs(x - y) < 1e-9 : x === y;
    const match = Object.keys(RISK_PRESETS).find(k => TESTED_KEYS.every(f => near(b[f], RISK_PRESETS[k][f])));
    const diffs = [];
    if (!match) { const ref = RISK_PRESETS[RISK_PRESETS[b.profile] ? b.profile : 'balanced']; TESTED_KEYS.forEach(f => { if (!near(b[f], ref[f])) diffs.push(f); }); }
    if (b.strategy !== 'auto') diffs.push('strategy');
    if (b.targetMode !== 'atr') diffs.push('targetMode');
    if (b.trailing && b.protectMode === 'tight') diffs.push('protectMode');
    return { match: diffs.length ? null : match, nearest: match || (RISK_PRESETS[b.profile] ? b.profile : 'balanced'), diffs };
  }
  const DIFF_LABEL = { timeframe: 'timeframe', threshold: 'entry threshold', minConfidence: 'confidence', slAtr: 'stop-loss', tpAtr: 'take-profit', htfFilter: 'trend filter', exitOnFlip: 'flip exit', trailing: 'protect profits', strategy: 'strategy (tested on Auto)', targetMode: 'fixed $ targets (tested on ATR)', protectMode: 'protect profits set to keep % (tested lower than Standard)' };
  function applyTested(k) {
    if (level() === 'beginner' && k === 'aggressive') k = 'balanced';
    Object.assign(S.bot, RISK_PRESETS[k], { profile: k, strategy: 'auto', targetMode: 'atr', protectMode: 'standard', botV: 2 });
  }
  function setLevel(lv) {
    S.profile.level = lv; const b = S.bot;
    if (lv === 'beginner') { b.newsPause = true; applyTested(['conservative', 'balanced'].includes(b.profile) ? b.profile : 'conservative'); Object.assign(b, { basketTp: 0, basketSl: 0, intervalSec: 10 }); }
    if (lv === 'moderate' && b.timeframe === '5m') b.timeframe = '15m';
    save(); S.candleCache = {}; resetSeries();
  }
  const S = {
    profile: store.get('profile'),               // {name, email, pinHash, biometric, riskProfile, color, created}
    theme: (t => ['system', 'light'].includes(t) ? t : t ? 'midnight' : 'system')(store.get('themeV2') ? store.get('theme') : 'system'), // dark styles folded into Midnight
    systemDark: 'midnight',
    heroAlpha: store.get('heroAlpha') ?? 0.65,
    prefs: { confirmClose: 'always', hideByDefault: false, ...(store.get('prefs') || {}) },
    privacy: false,                                  // amounts hidden right now (eye button)   // confirmClose: always | loss | off      // dashboard card opacity (0.15–1)
    onboarded: store.get('onboarded') || false,
    conn: store.get('conn') || { mode: 'demo' },  // {mode:'demo'|'mt5', accountId, region, login, server}
    bot: { ...DEFAULT_BOT, botV: store.get('bot') ? 1 : 2, ...(store.get('bot') || {}) },
    newsKey: store.get('newsKey') || '',
    log: store.get('log') || [],
    tab: 'home', broker: null, account: null, positions: [], history: [], analysis: {}, mood: null,
    pollMs: 0, focus: 'EURUSD', unlocked: false, status: 'Offline', dayStart: store.get('dayStart'),
  };
  if (S.bot.kfV !== 2) { if (S.bot.keepFrom === 'entry') S.bot.keepFrom = 'prog'; S.bot.kfV = 2; store.set('bot', S.bot); }
  if (S.bot.enabled && S.conn.mode !== 'demo') S.bot.enabled = false; // never auto-resume live trading after restart

  /* ---------------- Helpers ---------------- */
  const fmt = (v, d = 2) => (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const MASK = '•••••';
  const cur = (c = S.account?.currency || 'USD') => c === 'USD' ? '$' : c + ' ';
  const money = (v, c) => S.privacy ? cur(c) + MASK : (v < 0 ? '-' : '') + cur(c) + fmt(Math.abs(v));
  const signed = v => S.privacy ? cur() + MASK : (v >= 0 ? '+' : '-') + money(Math.abs(v)).replace('-', '');
  const maskId = (t, keep = 0) => S.privacy && t ? (keep ? String(t).slice(0, keep) : '') + '••••' : t;
  const maskEmail = e => S.privacy && e ? e[0] + '•••@' + (e.split('@')[1] || '•••') : e;
  // Amounts inside stored log lines (written before hiding was turned on)
  const maskText = t => S.privacy ? String(t).replace(/[+\-−]?\$\s?[\d,]+(\.\d+)?/g, '$' + MASK).replace(/\(([+\-−]?)\$[\d,.]+\)/g, '($' + MASK + ')') : t;
  const digits = sym => S.digitsOf?.[sym] ?? Brokers.SPECS[sym]?.digits ?? (sym.includes('JPY') ? 3 : 5);
  const px = (sym, v) => fmt(v, digits(sym));
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = v => S.privacy ? '' : v > 0 ? 'up' : v < 0 ? 'down' : '';   // no win/loss colours while amounts are hidden
  const sentCls = s => s >= 25 ? 'up' : s <= -25 ? 'down' : 'neutral';
  const save = () => { store.set('bot', S.bot); store.set('conn', S.conn); store.set('profile', S.profile); store.set('theme', S.theme); store.set('heroAlpha', S.heroAlpha); store.set('prefs', S.prefs); refreshTested(); };
  let toastT; function toast(msg) { const t = $('#toast'); t.onclick = null; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function log(msg, kind = '') { S.log.unshift({ t: Date.now(), msg, kind }); S.log = S.log.slice(0, 200); store.set('log', S.log); const el = $('#botlog'); if (el) el.innerHTML = logHtml(); }
  /* Theme: 'system' follows the phone's light/dark mode (dark uses the chosen dark theme). */
  const darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const systemIsDark = () => !darkMQ || darkMQ.matches;
  const resolvedTheme = () => S.theme === 'system' ? (systemIsDark() ? S.systemDark : 'light') : S.theme;
  function applyTheme() {
    const t = resolvedTheme(), bg = THEMES[t][0];
    if (document.documentElement.dataset.theme !== t) {
      document.documentElement.dataset.theme = t;
      if (S.unlocked && $('#view')) { $('#view').dataset.view = ''; renderView(); } // redraw charts with the new colours
    }
    document.querySelector('meta[name=theme-color]').content = bg;
    // Native status/navigation bar area: background colour + light or dark icons
    try { themeBars()?.set({ color: bg, light: t === 'light' }); } catch { }
    // Capacitor's SystemBars decides the status/navigation icon colour: LIGHT = dark icons for a light page
    try { const C = window.Capacitor; if (C?.isNativePlatform?.()) (C.Plugins?.SystemBars || (S._sb ||= C.registerPlugin?.('SystemBars')))?.setStyle({ style: t === 'light' ? 'LIGHT' : 'DARK' }); } catch { }
  }
  /* Native helper (ThemeBars, registered in MainActivity). registerPlugin is the reliable way to reach it. */
  function themeBars() { const C = window.Capacitor; if (!C?.isNativePlatform?.()) return null; return C.Plugins?.ThemeBars || (S._tb ||= C.registerPlugin?.('ThemeBars')); }
  /* The app always draws edge-to-edge (behind transparent status / navigation bars, padded by the safe-area
     insets). "Hide status & navigation bars" additionally hides them (swipe from an edge to peek). */
  async function applyFullscreen() {
    const hide = !!S.prefs.hideBars, tb = themeBars();
    document.documentElement.classList.toggle('bars-hidden', hide);
    try { await tb?.fullscreen({ on: hide }); } catch { }
  }
  /* Dashboard equity card opacity: CSS variable + readable text colours when it gets light. */
  function applyHero() {
    document.documentElement.style.setProperty('--hero-a', String(S.heroAlpha));
    $$('.card.hero').forEach(el => el.classList.toggle('soft', S.heroAlpha < .7));
  }
  function setTheme(t) { S.theme = t; store.set('themeV2', true); save(); applyTheme(); }
  darkMQ?.addEventListener?.('change', () => { if (S.theme === 'system') applyTheme(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => { applyTheme(); applyFullscreen(); }, 150); });

  /* ---------------- Flicker-free DOM patching ----------------
     First paint uses innerHTML; later refreshes diff the new markup against the live DOM and
     touch only changed text/attributes. Canvases, inputs and [data-keep] nodes are left alone. */
  const num = t => { const m = String(t).match(/-?\$?[\d,]*\.?\d+/); return m ? parseFloat(m[0].replace(/[$,]/g, '')) : NaN; };
  function flash(el, before, after) {
    if (!el || !el.closest || !el.closest('.mono, .val, .big, .title, .chip, text')) return;
    const a = num(before), b = num(after); if (isNaN(a) || isNaN(b) || a === b) return;
    const c = b > a ? 'flash-up' : 'flash-down'; el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(c);
  }
  function morph(a, b) {
    const ac = a.childNodes, bc = b.childNodes;
    for (let i = 0; i < bc.length; i++) {
      const x = ac[i], y = bc[i];
      if (!x) { a.appendChild(y.cloneNode(true)); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName || (x.nodeType === 1 && x.getAttribute('data-key') !== y.getAttribute('data-key'))) { a.replaceChild(y.cloneNode(true), x); continue; }
      if (x.nodeType === 3) { if (x.nodeValue !== y.nodeValue) { const old = x.nodeValue; x.nodeValue = y.nodeValue; flash(x.parentNode, old, y.nodeValue); } continue; }
      if (x.nodeType !== 1 || x.tagName === 'CANVAS' || x.tagName === 'INPUT' || x.hasAttribute('data-keep')) continue;
      for (const at of [...x.attributes]) if (!y.hasAttribute(at.name) && !(at.name === 'class' && /flash-|enter-/.test(at.value))) x.removeAttribute(at.name);
      for (const at of [...y.attributes]) {
        if (at.name === 'class') { const fl = [...x.classList].filter(c => c.startsWith('flash-') || c.startsWith('enter-')); const want = at.value + (fl.length ? ' ' + fl.join(' ') : ''); if (x.getAttribute('class') !== want) x.setAttribute('class', want); }
        else if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
      }
      morph(x, y);
    }
    while (ac.length > bc.length) a.removeChild(a.lastChild);
  }
  /* Paint `html` into `el`. Same view key as last time → patch in place; otherwise full render. */
  function paint(el, html, key) {
    if (el.dataset.view === key) { const t = document.createElement('div'); t.innerHTML = html; morph(el, t); }
    else { el.innerHTML = html; el.dataset.view = key; }
  }

  /* ---------------- Icons ---------------- */
  const P = {
    exit: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>',
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 6-6"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8 14h.01M16 14h.01M9 18h6"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    fp: '<path d="M12 11v3a8 8 0 0 1-1.5 4.5"/><path d="M8.5 6.6A6 6 0 0 1 18 11v2"/><path d="M6 10a6 6 0 0 1 .6-2.6"/><path d="M6 14v-3"/><path d="M9 11a3 3 0 0 1 6 0v3a11 11 0 0 1-1 4.5"/><path d="M17.5 17.5c.3-1 .5-2.2.5-3.5"/><path d="M8.5 21A11 11 0 0 0 9 14v-1"/>',
    pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 21h4"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>', back: '<path d="M15 18l-6-6 6-6"/>', del: '<path d="M21 5H9l-6 7 6 7h12z"/><path d="M17 9l-6 6M11 9l6 6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  };
  const icon = (n, c = 'i') => `<svg class="${c}" viewBox="0 0 24 24">${P[n]}</svg>`;
  const logo = `<div class="logo"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></div>`;

  /* ================= SCREENS ================= */
  function render() {
    if (!S.onboarded) return renderWelcome();
    if (!S.profile) return renderSetup();
    if (!S.unlocked) return renderLock();
    renderMain();
  }

  /* ---------- Welcome ---------- */
  function renderWelcome() {
    const slides = [
      { ic: 'pulse', t: 'Read the market<br><span class="grad-text">like a pro</span>', d: 'Tradebot blends trend, momentum, order flow and news into one live sentiment score for every symbol.' },
      { ic: 'bot', t: 'Let the bot<br><span class="grad-text">trade for you</span>', d: 'Connect your MT5 account and let disciplined, risk-managed automation execute signals 24/5.' },
      { ic: 'shield', t: 'Locked with<br><span class="grad-text">your fingerprint</span>', d: 'Biometric unlock, encrypted credential storage and hard daily-loss limits keep you in control.' },
    ];
    let i = 0;
    app.innerHTML = `<div class="screen welcome">
      <div class="row between"><div class="brand">${logo}Tradebot</div><button class="muted" id="skip">Skip</button></div>
      <div class="slides">${slides.map(s => `<div class="slide"><div class="art">${icon(s.ic, '')}</div><h1>${s.t}</h1><p>${s.d}</p></div>`).join('')}</div>
      <div class="dots">${slides.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div>
      <button class="btn" id="next">Continue</button>
    </div>`;
    const go = k => { i = k; $$('.slide').forEach(s => s.style.transform = `translateX(-${i * 100}%)`); $$('.dots i').forEach((d, n) => d.classList.toggle('on', n === i)); $('#next').textContent = i === slides.length - 1 ? 'Get started' : 'Continue'; };
    const finish = () => { S.onboarded = true; store.set('onboarded', true); render(); };
    $('#next').onclick = () => i < slides.length - 1 ? go(i + 1) : finish();
    $('#skip').onclick = finish;
    let x0 = null; const sl = $('.slides');
    sl.addEventListener('touchstart', e => x0 = e.touches[0].clientX, { passive: true });
    sl.addEventListener('touchend', e => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (dx < -50 && i < slides.length - 1) go(i + 1); if (dx > 50 && i > 0) go(i - 1); x0 = null; });
  }

  /* ---------- Profile setup ---------- */
  async function renderSetup() {
    const bio = await Security.available();
    let risk = 'conservative', color = AVATAR_COLORS[0], lvl = 'beginner';
    app.innerHTML = `<div class="screen">
      <div class="brand" style="margin-bottom:26px">${logo}Tradebot</div>
      <h1>Create your <span class="grad-text">profile</span></h1>
      <p class="muted" style="margin-top:0">This stays on your device. You can change it anytime.</p>
      <div class="field"><label>Display name</label><input class="input" id="name" placeholder="e.g. Alex" maxlength="24"></div>
      <div class="field"><label>Email (optional)</label><input class="input" id="email" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Avatar colour</label><div class="row">${AVATAR_COLORS.map((c, k) => `<button class="avatar cpick" data-c="${c}" style="background:${c};width:36px;height:36px;border-radius:12px;${k ? '' : 'outline:3px solid var(--text)'}"></button>`).join('')}</div></div>
      <div class="field"><label>Trading experience</label><div class="seg" id="lvl">${Object.entries(LEVELS).map(([k, l]) => `<button data-l="${k}" class="${k === lvl ? 'on' : ''}">${l.label}</button>`).join('')}</div>
        <div class="hint" id="lvlhint">${LEVELS[lvl].desc}</div></div>
      <div class="field"><label>Risk profile</label><div class="seg" id="risk">${Object.entries(RISK_PRESETS).map(([k, v]) => `<button data-k="${k}" class="${k === risk ? 'on' : ''} ${k === 'aggressive' && lvl === 'beginner' ? 'hidden' : ''}">${v.label}</button>`).join('')}</div>
        <div class="hint" id="riskhint"></div></div>
      <div class="field"><label>6-digit PIN</label><input class="input mono" id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>
      <div class="field"><label>Confirm PIN</label><input class="input mono" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>
      <div class="card row between"><div class="row">${icon('fp')}<div><div class="title">Fingerprint unlock</div><div class="sub">${bio.ok ? 'Available on this device' : bio.simulated ? 'Simulated in browser preview' : 'Not available — PIN will be used'}</div></div></div>
        <label class="toggle"><input type="checkbox" id="bio" ${bio.ok || bio.simulated ? 'checked' : 'disabled'}><span></span></label></div>
      <button class="btn" id="create" style="margin-top:8px">Create profile</button>
    </div>`;
    const hint = () => { const p = RISK_PRESETS[risk]; $('#riskhint').textContent = `${p.timeframe} candles · ${p.riskPct}% risk per trade · max ${p.maxPositions} positions · stop at -${p.dailyLossPct}% per day`; };
    hint();
    $$('#lvl button').forEach(b => b.onclick = () => {
      lvl = b.dataset.l; $$('#lvl button').forEach(x => x.classList.toggle('on', x === b)); $('#lvlhint').textContent = LEVELS[lvl].desc;
      $('#risk [data-k=aggressive]').classList.toggle('hidden', lvl === 'beginner');
      if (lvl === 'beginner' && risk === 'aggressive') $('#risk [data-k=balanced]').click();
    });
    $$('#risk button').forEach(b => b.onclick = () => { risk = b.dataset.k; $$('#risk button').forEach(x => x.classList.toggle('on', x === b)); hint(); });
    $$('.cpick').forEach(b => b.onclick = () => { color = b.dataset.c; $$('.cpick').forEach(x => x.style.outline = x === b ? '3px solid var(--text)' : ''); });
    $('#create').onclick = async () => {
      const name = $('#name').value.trim(), pin = $('#pin').value, pin2 = $('#pin2').value;
      if (!name) return toast('Please enter your name');
      if (!/^\d{6}$/.test(pin)) return toast('PIN must be 6 digits');
      if (pin !== pin2) return toast('PINs do not match');
      if ($('#bio').checked && bio.ok && !(await Security.verify('Confirm fingerprint to enable unlock'))) return toast('Fingerprint not confirmed');
      S.profile = { name, email: $('#email').value.trim(), pinHash: await Security.hashPin(pin), biometric: $('#bio').checked, riskProfile: risk, level: lvl, color, created: Date.now() };
      applyTested(risk);
      save(); S.unlocked = true; toast(`Welcome, ${name}!`); render(); boot();
    };
  }

  /* ---------- Lock screen ---------- */
  function renderLock() {
    let pin = '';
    app.innerHTML = `<div class="screen lock">
      <div class="avatar" style="background:${S.profile.color};width:64px;height:64px;border-radius:22px;font-size:22px;color:#fff">${esc(S.profile.name[0]).toUpperCase()}</div>
      <h2 style="margin-top:14px">Welcome back, ${esc(S.profile.name)}</h2>
      <div class="muted">${S.profile.biometric ? 'Touch the sensor or enter your PIN' : 'Enter your PIN'}</div>
      ${S.profile.biometric ? `<button class="fp" id="fp">${icon('fp', '')}</button>` : '<div style="height:30px"></div>'}
      <div class="pin-dots">${'<i></i>'.repeat(6)}</div>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<span></span><button data-n="0">0</button><button data-n="del">${icon('del')}</button></div>
    </div>`;
    const dots = () => $$('.pin-dots i').forEach((d, k) => d.classList.toggle('on', k < pin.length));
    const unlock = () => { S.unlocked = true; S.privacy = !!S.prefs.hideByDefault; document.documentElement.classList.toggle('private', S.privacy); render(); boot(); };
    $$('.keypad button').forEach(b => b.onclick = async () => {
      const n = b.dataset.n; if (n === 'del') pin = pin.slice(0, -1); else if (pin.length < 6) pin += n; dots();
      if (pin.length === 6) {
        if (await Security.hashPin(pin) === S.profile.pinHash) unlock();
        else { pin = ''; dots(); const pd = $('.pin-dots'); pd.classList.add('fp', 'bad'); setTimeout(() => pd.classList.remove('fp', 'bad'), 400); toast('Wrong PIN'); }
      }
    });
    const fp = $('#fp');
    if (fp) {
      const scan = async () => { fp.classList.add('scan'); const ok = await Security.verify('Unlock Tradebot'); fp.classList.remove('scan'); if (ok) { fp.classList.add('ok'); setTimeout(unlock, 350); } else { fp.classList.add('bad'); setTimeout(() => fp.classList.remove('bad'), 400); } };
      fp.onclick = scan; if (Security.isNative()) setTimeout(scan, 300);
    }
  }

  /* ---------- Main shell ---------- */
  function renderMain() {
    const tabs = [['home', 'home', 'Home'], ['markets', 'chart', 'Markets'], ['bot', 'bot', 'Auto-Trade'], ['portfolio', 'wallet', 'Portfolio'], ['profile', 'user', 'Profile']];
    app.innerHTML = `<div id="view"></div><nav class="nav"><div class="nav-inner">${tabs.map(([k, ic, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${icon(ic)}${l}</button>`).join('')}</div></nav>`;
    $$('.nav button').forEach(b => b.onclick = () => { if (!S.slideTo?.(b.dataset.tab)) goTab(b.dataset.tab); });
    renderView();
  }
  /* ---------- Navigation + Android back button ----------
     Back closes the top dialog/sheet → otherwise jumps straight to Home → on Home, press twice to exit. */
  const navStack = [];
  const TAB_ORDER = ['home', 'markets', 'bot', 'portfolio', 'profile'];
  /* Rotation: re-lay out the current page and any open panel when the screen width changes
     (height-only changes are the keyboard opening, which must not rebuild the page under the cursor). */
  let lastW = innerWidth, rotT;
  addEventListener('resize', () => {
    if (innerWidth === lastW) return; lastW = innerWidth;
    clearTimeout(rotT); rotT = setTimeout(() => {
      applyFullscreen(); $$('.peek').forEach(x => x.remove()); const sc = $('#view .screen'); if (sc) sc.style.transform = '';
      if ($('#view') && S.tab) { $('#view').dataset.view = ''; renderView(); }
      if ($('#tradesheet')) tradeSheetUpdate();
      if ($('#symsheet')) { symbolSheetUpdate(); drawChart($('#symchart'), S.focus); }
      if (S.tab === 'home' && S.tradeIdx) { const sl = $('.tslider'); if (sl) sl.scrollLeft = S.tradeIdx * sl.clientWidth; }
    }, 150);
  });
  function goTab(tab, fromBack = false, dir = 0, noAnim = false) {
    if (!$('#view') || tab === S.tab) return;
    if (!dir) dir = Math.sign(TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(S.tab));
    if (!fromBack) { navStack.push(S.tab); if (navStack.length > 30) navStack.shift(); }
    if (S.tab === 'bot') S.settingsUnlocked = false;   // settings re-lock when you leave Auto-Trade
    S.tab = tab;
    $$('.nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $('#view').dataset.view = ''; renderView(); window.scrollTo(0, 0); document.body.scrollTop = 0;
    // Arriving by swipe: the page is already on screen, so no entry animation at all (the default fade made it flicker).
    // 'enter-*' classes are preserved by live-refresh patching, so this can't re-trigger an animation later.
    const scr = $('#view .screen'); if (scr) scr.classList.add(noAnim ? 'enter-none' : dir > 0 ? 'enter-right' : 'enter-left');
    if (tab === 'markets') analyseAll();
  }
  /* Swipe between tabs like a native pager: the neighbouring page is rendered beside the current one and both
     move 1:1 with the finger. On release the slide finishes from where the finger left it, at the finger's speed. */
  (function setupSwipeTabs() {
    const VIEWS = { home: viewHome, markets: viewMarkets, bot: viewBot, portfolio: viewPortfolio, profile: viewProfile };
    let sx = null, sy = 0, mode = null, cur = null, peek = null, peekDir = 0, dx = 0, lastX = 0, lastT = 0, vx = 0, settling = false;
    const W = () => ($('#app')?.clientWidth || innerWidth);
    const canScrollX = el => el && el.scrollWidth > el.clientWidth + 2;
    const neighbour = dir => TAB_ORDER[TAB_ORDER.indexOf(S.tab) + dir];
    function makePeek(dir, target) {
      dropPeek();
      const tab = target || neighbour(dir); if (!tab) return;
      peek = document.createElement('div'); peek.className = 'peek'; peek.setAttribute('aria-hidden', 'true');
      document.body.appendChild(peek);
      const saveTab = S.tab; S.tab = tab;                       // render the neighbour exactly as it will look
      try { VIEWS[tab](peek); } catch { } finally { S.tab = saveTab; }
      peekDir = dir; peek.style.transform = `translate3d(${dir * W() + dx}px,0,0)`;
    }
    function dropPeek() { if (peek) { peek.remove(); peek = null; peekDir = 0; } }
    function place(x) {
      cur.style.transform = `translate3d(${x}px,0,0)`;
      if (peek) peek.style.transform = `translate3d(${peekDir * W() + x}px,0,0)`;
    }
    // Easing curves: STANDARD accelerates and decelerates gently (taps); GLIDE starts at ~1.8× average speed
    // so a released swipe continues at the finger's speed and slows down evenly, with no hard stop.
    const STANDARD = 'cubic-bezier(.4,0,.2,1)', GLIDE = 'cubic-bezier(.25,.46,.45,.94)';
    function animate(x, ms, done, ease = GLIDE) {
      const tr = `transform ${ms}ms ${ease}`;
      cur.style.transition = tr; if (peek) peek.style.transition = tr;
      place(x); setTimeout(done, ms);
    }
    document.addEventListener('touchstart', e => {
      sx = null; mode = null;
      if (settling || e.touches.length !== 1 || !S.unlocked || !$('#view') || $('.sheet-bg') || $('.dlg-bg')) return;
      const t = e.touches[0];
      if (t.clientX < 16 || t.clientX > innerWidth - 16) return;            // screen edges belong to Android's back gesture
      if (e.target.closest('input, textarea, select, .nav, .keypad')) return;
      const sc = e.target.closest('.tslider, .tabs-mini'); if (sc && canScrollX(sc)) return; // real horizontal lists keep scrolling
      cur = $('#view .screen'); if (!cur) return;
      sx = lastX = t.clientX; sy = t.clientY; lastT = performance.now(); dx = 0; vx = 0;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (sx == null) return;
      const t = e.touches[0], ddx = t.clientX - sx, ddy = t.clientY - sy;
      if (!mode) {
        if (Math.abs(ddx) < 5 && Math.abs(ddy) < 5) return;
        mode = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
        if (mode === 'h') { S._dragging = true; cur.style.transition = 'none'; cur.style.willChange = 'transform'; } // page stays exactly under the finger
        else return;
      }
      if (mode !== 'h') return;
      if (e.cancelable) e.preventDefault();
      const now = performance.now(), raw = t.clientX - sx;
      vx = .8 * ((t.clientX - lastX) / Math.max(1, now - lastT)) + .2 * vx; lastX = t.clientX; lastT = now;
      const dir = raw < 0 ? 1 : -1;
      if (raw !== 0 && dir !== peekDir) makePeek(dir);                  // render the page we're moving towards
      dx = peek ? raw : raw * .3;                                       // no neighbour (first/last tab): resist
      place(dx);
    }, { passive: false });
    const end = () => {
      if (sx == null) return; sx = null;
      if (mode !== 'h') { mode = null; return; }
      mode = null;
      const w = W(), commit = peek && (Math.abs(dx) > w * .25 || (Math.abs(vx) > .25 && Math.sign(vx) === Math.sign(dx)));
      if (commit) {
        const target = neighbour(peekDir), to = -peekDir * w, remain = Math.abs(to - dx);
        // duration chosen so the glide starts at the finger's speed (initial slope of GLIDE ≈ 1.84)
        const ms = Math.round(Math.max(200, Math.min(380, 1.84 * remain / Math.max(Math.abs(vx), .5))));
        settling = true;
        animate(to, ms, () => {
          goTab(target, false, peekDir, true);                          // same content the peek showed, so it swaps invisibly
          dropPeek(); S._dragging = false; settling = false;
        });
      } else {
        settling = true;
        animate(0, 260, () => { cur.style.transition = ''; cur.style.transform = ''; cur.style.willChange = ''; dropPeek(); S._dragging = false; settling = false; });
      }
    };
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);

    /* Same side-by-side slide for bottom-bar taps and Back: target page slides in, current page slides out. */
    S.slideTo = tab => {
      if (settling || sx != null || tab === S.tab || !S.unlocked || !$('#view')) return false;
      cur = $('#view .screen'); if (!cur) return false;
      const dir = Math.sign(TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(S.tab)) || 1;
      $$('.nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));   // highlight the icon right away
      settling = true; S._dragging = true; dx = 0;
      cur.style.transition = 'none'; cur.style.willChange = 'transform';
      makePeek(dir, tab);
      requestAnimationFrame(() => requestAnimationFrame(() =>
        animate(-dir * W(), 320, () => { goTab(tab, false, dir, true); dropPeek(); S._dragging = false; settling = false; }, STANDARD)));
      return true;
    };
  })();
  function handleBack() {
    const dlg = $$('.dlg-bg').at(-1); if (dlg && dlg._cancel) { dlg._cancel(); return; }
    const sheets = $$('.sheet-bg:not(.closing)'); if (sheets.length) { closeSheet(sheets.at(-1)); return; }
    if (S.unlocked && $('#view') && S.tab !== 'home') { if (!S.slideTo?.('home')) goTab('home', true, -1); return; }
    confirmExit();
  }
  /* Back on Home (or the welcome / lock screen): ask before leaving, and say what happens to the bot. */
  async function confirmExit() {
    if (S._exitAsk) return; S._exitAsk = true;
    const bots = S.unlocked ? S.positions.filter(isBot).length : 0, live = S.unlocked && isLive(), on = S.unlocked && S.bot.enabled;
    const msg = !on ? 'You can come back any time. Your settings and trades are kept.'
      : live ? `The Sentiment Bot <b>stops while Tradebot is closed</b>: no new trades, no trailing stop or sentiment exits.${bots ? ` Your ${bots} open bot trade${bots > 1 ? 's keep their' : ' keeps its'} stop-loss and take-profit at your broker.` : ''}`
      : 'The Sentiment Bot and the paper market <b>pause while Tradebot is closed</b>, and carry on from where they left off when you come back.';
    const ok = await ask({ title: 'Exit Tradebot?', message: msg, ok: 'Exit', cancel: 'Stay', tone: on && live ? 'danger' : 'primary', ic: 'exit' });
    S._exitAsk = false;
    if (!ok) return;
    const A = window.Capacitor?.Plugins?.App; if (A) A.exitApp();
  }
  (function setupBack() {
    const A = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.App;
    if (A) { A.addListener('backButton', handleBack); return; }
    // Browser preview / fallback: trap history so the browser back button behaves the same way
    history.pushState({ tb: 1 }, ''); addEventListener('popstate', () => { handleBack(); history.pushState({ tb: 1 }, ''); });
  })();

  function renderView() {
    const v = $('#view'); if (!v) return;
    ({ home: viewHome, markets: viewMarkets, bot: viewBot, portfolio: viewPortfolio, profile: viewProfile })[S.tab](v);
  }
  /* Live refresh: only the screens without form inputs re-render fully. */
  function refreshLive() {
    if (!S.unlocked || !$('#view') || S._dragging) return;
    if (['home', 'markets', 'portfolio'].includes(S.tab)) renderView();
    if (S.tab === 'bot') { const st = $('#botstat'); if (st) { paint(st, botStatusHtml(), 'bot'); const t = $('#bottoggle'); t.checked = S.bot.enabled; t.onchange = e => toggleBot(e.target.checked); bindPositions(st); }
      const rd = $('#radar'); if (rd) paint(rd, radarHtml(), 'radar'); }
    const sh = $('#symsheet'); if (sh) symbolSheetUpdate();
    if ($('#tradesheet')) tradeSheetUpdate();
    const cl = $('#closelist'); if (cl) paint(cl, closeRowsHtml(), 'close');
  }

  const topbar = (title) => `<div class="topbar"><div><div class="hello">${greeting()}, ${esc(S.profile.name)}</div><h2>${title}</h2></div>
    <div class="row" style="gap:8px"><button class="icon-btn eye ${S.privacy ? 'on' : ''}" id="eyebtn" aria-label="${S.privacy ? 'Show amounts' : 'Hide amounts'}" title="${S.privacy ? 'Show amounts' : 'Hide amounts'}">${icon(S.privacy ? 'eyeoff' : 'eye')}</button>
    <button class="ring" id="ring" data-keep title="Live data · tap to refresh now">${ringSvg}</button>
    <button class="icon-btn" id="connbtn" title="Account">${isLive() ? `<span class="dot ${S.status === 'Connected' ? 'live' : ''}"></span>` : icon('link')}</button></div></div>`;
  const ringSvg = '<svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="prog" cx="18" cy="18" r="15"/></svg><i></i>';
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const bindTop = () => {
    const b = $('#connbtn'); if (b) b.onclick = openConnect;
    const e = $('#eyebtn'); if (e) e.onclick = () => setPrivacy(!S.privacy, true);
    const r = $('#ring'); if (r && !r.onclick) { r.onclick = () => { poll(); analyseAll(); }; ringCycle(); }
  };
  const profileSub = () => `${maskEmail(S.profile.email) || 'No email'} · since ${new Date(S.profile.created).toLocaleDateString()}`;
  const acctTitle = () => isLive() ? `MT5 · ${maskId(S.conn.login || S.conn.accountId?.slice(0, 8), 2)}` : 'Paper trading';
  /* ---------- About / version / changelog ---------- */
  const BUILD = window.TB_BUILD || { version: 'dev', build: null, commit: '', date: '', changelog: '' };
  async function loadAppInfo() {   // the installed version as Android reports it (falls back to the bundled build info)
    if (S.appInfo) return S.appInfo;
    try { const i = await window.Capacitor?.Plugins?.App?.getInfo?.(); if (i?.version) return (S.appInfo = { version: i.version, build: i.build }); } catch { }
    return (S.appInfo = { version: BUILD.version, build: BUILD.build });
  }
  function aboutHtml() {
    const v = S.appInfo || { version: BUILD.version, build: BUILD.build };
    const conn = S.conn.mode === 'bridge' ? `Own VPS bridge${S.bridgeVersion ? ' v' + S.bridgeVersion : ''}` : S.conn.mode === 'mt5' ? 'MetaApi' : 'Paper trading';
    const built = BUILD.date ? new Date(BUILD.date).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    return `<div class="row between"><div class="row">${logo}<div><div class="title">Tradebot</div><div class="sub">Version <b class="mono">${esc(v.version)}</b>${v.build ? ` · build ${esc(String(v.build))}` : ''}</div></div></div>
        <button class="btn small" id="whatsnew">What's new</button></div>
      <div class="kv"><span>Built</span><b>${esc(built)}</b></div>
      <div class="kv"><span>Commit</span><b class="mono">${esc(BUILD.commit || '—')}</b></div>
      <div class="kv"><span>Connection</span><b>${esc(conn)}</b></div>`;
  }
  /* Minimal Markdown → HTML for CHANGELOG.md (headings, nested bullets, bold, code). */
  function mdToHtml(md) {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    let html = '', depth = 0;
    const closeTo = d => { while (depth > d) { html += '</ul>'; depth--; } };
    md.split('\n').forEach(line => {
      const li = line.match(/^(\s*)- (.*)$/);
      if (li) { const d = Math.floor(li[1].length / 2) + 1; while (depth < d) { html += '<ul>'; depth++; } closeTo(d); html += `<li>${inline(li[2])}</li>`; return; }
      closeTo(0);
      if (/^# /.test(line)) return;                                            // document title
      const h2 = line.match(/^## \[(.+?)\]\s*-?\s*(.*)$/); if (h2) { html += `<h4 class="cl-ver"><span>v${esc(h2[1])}</span><small>${esc(h2[2])}</small></h4>`; return; }
      const h3 = line.match(/^### (.*)$/); if (h3) { html += `<div class="cl-kind ${h3[1].toLowerCase().replace(/[^a-z]/g, '')}">${esc(h3[1])}</div>`; return; }
      if (line.trim()) html += `<p>${inline(line)}</p>`;
    });
    closeTo(0); return html;
  }
  function openChangelog() {
    const v = S.appInfo || BUILD;
    sheet(`<h2>What's new</h2><p class="sub" style="margin-top:2px">Installed: v${esc(v.version)}${v.build ? ' · build ' + esc(String(v.build)) : ''}</p>
      <div class="changelog">${mdToHtml(BUILD.changelog || 'No changelog in this build.')}</div>`);
  }
  async function announceUpdate() {   // one-time note after the app was updated
    const v = (await loadAppInfo()).version, seen = store.get('seenVersion');
    if (seen && seen !== v) setTimeout(() => {
      const t = $('#toast'); t.innerHTML = `🎉 Updated to v${esc(v)} · <u>What's new</u>`; t.classList.add('show'); t.onclick = () => { t.classList.remove('show'); openChangelog(); };
      clearTimeout(toastT); toastT = setTimeout(() => { t.classList.remove('show'); t.onclick = null; }, 6000);
    }, 1200);
    store.set('seenVersion', v);
  }
  /* Eye button: hide/show money amounts and account identifiers everywhere. */
  function setPrivacy(on, announce) {
    S.privacy = on;
    document.documentElement.classList.toggle('private', on);
    // Patch values in place (same mechanism as the live refresh) instead of rebuilding the screen
    const e = $('#eyebtn');
    if (e) { e.classList.toggle('on', on); e.innerHTML = icon(on ? 'eyeoff' : 'eye'); e.title = e.ariaLabel = on ? 'Show amounts' : 'Hide amounts'; }
    refreshLive();                                    // Home / Markets / Portfolio, bot status, open sheets
    const lg = $('#botlog'); if (lg) lg.innerHTML = logHtml();
    const pid = $('#pidsub'); if (pid) pid.textContent = profileSub();
    const pac = $('#pacct'); if (pac) pac.textContent = acctTitle();
    const pn = $('#pnow'); if (pn) pn.checked = on;
    const hp = $('#heropvv'); if (hp) hp.textContent = money(10000);
    if (announce) toast(on ? '🙈 Amounts hidden' : '👁 Amounts visible');
  }
  /* Circular countdown to the next refresh; spins while a refresh is in flight. */
  function ringCycle() {
    const r = $('#ring'); if (!r) return;
    r.style.setProperty('--dur', S.pollMs + 'ms'); r.classList.remove('run'); void r.offsetWidth; r.classList.add('run');
  }
  const ringBusy = on => { const r = $('#ring'); if (r) r.classList.toggle('busy', on); };

  /* ---------- Home ---------- */
  function viewHome(v) {
    const a = S.account || {}, pl = (a.equity ?? 0) - (a.balance ?? 0);
    const focus = S.analysis[S.focus];
    const mood = S.mood || { score: 0, label: 'Analysing…', bulls: 0, bears: 0 };
    paint(v, `<div class="screen">${topbar('Dashboard')}
      <div class="card hero ${S.heroAlpha < .7 ? 'soft' : ''}">
        <div class="row between"><span class="muted">Equity · ${esc(a.name || '—')}</span><span class="chip">${isLive() ? 'LIVE MT5' : 'PAPER'}</span></div>
        <div class="big mono" style="margin:6px 0 12px">${money(a.equity ?? 0)}</div>
        <div class="grid3"><div class="stat"><div class="lbl">Balance</div><div class="val mono">${money(a.balance ?? 0)}</div></div>
          <div class="stat"><div class="lbl">Floating</div><div class="val mono">${signed(pl)}</div></div>
          <div class="stat"><div class="lbl">Free margin</div><div class="val mono">${money(a.freeMargin ?? 0)}</div></div></div>
      </div>
      ${level() !== 'pro' && !S.prefs.guideHidden && guideSteps().some((x, i) => i < 4 && !x.done) ? `<div class="card guidecard" data-guide data-key="guide">${guideCardHtml()}</div>` : ''}
      ${liveTradesHtml()}
      <div class="card" id="newscard" data-key="newscard">${newsCardHtml()}</div>
      <div class="card"><div class="row between"><h2 style="font-size:17px">Market sentiment</h2><span class="chip ${sentCls(mood.score)}">${mood.label}</span></div>
        <div class="gauge-wrap">${gauge(mood.score)}<div class="grow">
          <div class="sub">Bullish symbols</div><div class="title up" style="font-size:20px">${mood.bulls}</div>
          <div class="sub" style="margin-top:6px">Bearish symbols</div><div class="title down" style="font-size:20px">${mood.bears}</div>
          <div class="sub" style="margin-top:6px">Bot: <b class="${S.bot.enabled ? 'up' : ''}">${S.bot.enabled ? 'Running' : 'Paused'}</b> · ${Engine.STRATEGIES[S.bot.strategy].icon} ${Engine.STRATEGIES[S.bot.strategy].label}</div></div></div></div>
      <div class="card"><div class="row between" style="margin-bottom:10px"><div><h2 style="font-size:17px">${S.focus}</h2><div class="sub mono">${focus ? px(S.focus, focus.price) : '—'} · ${S.bot.timeframe}</div></div>
        ${focus ? `<span class="chip ${sentCls(focus.score)}">${focus.score > 0 ? '+' : ''}${focus.score} ${focus.label}</span>` : ''}</div>
        <div class="tabs-mini" id="focus">${watch().map(s => `<button class="${s === S.focus ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
        <div class="chart-box" style="margin-top:10px"><canvas id="chart" height="230"></canvas></div></div>
      <h3>Bot activity</h3><div class="card log">${S.log.slice(0, 5).map(logRow).join('') || '<div class="empty">No activity yet</div>'}</div>
    </div>`, 'home');
    bindTop();
    $$('#focus button').forEach(b => b.onclick = () => { S.focus = b.dataset.s; renderView(); });
    bindPositions(v); bindTradeSlider(v);
    drawChart($('#chart'), S.focus);
  }
  const watch = () => S.bot.symbols.length ? S.bot.symbols : ['EURUSD'];
  /* ---------- Live trades (dashboard) ---------- */
  const age = t => { const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h`; };
  const clamp01 = x => Math.max(0, Math.min(1, x));
  function tradeCard(p) {
    const buy = p.type === 'POSITION_TYPE_BUY', bot = isBot(p), st = bot ? Engine.STRATEGIES[stratOf(p)] : null;
    let bar = '';
    if (p.stopLoss && p.takeProfit) {
      const span = p.takeProfit - p.stopLoss, cur = clamp01((p.currentPrice - p.stopLoss) / span), ent = clamp01((p.openPrice - p.stopLoss) / span);
      bar = `<div class="tbar"><i class="tfill ${cur >= ent ? 'up' : 'down'}" style="left:${Math.min(cur, ent) * 100}%;width:${Math.abs(cur - ent) * 100}%"></i><i class="tentry" style="left:${ent * 100}%"></i><i class="tnow" style="left:${cur * 100}%"></i></div>
        <div class="row between tlbl"><span class="down">SL ${px(p.symbol, p.stopLoss)}</span><span class="up">TP ${px(p.symbol, p.takeProfit)}</span></div>`;
    } else bar = `<div class="tlbl sub" style="margin-top:10px">No SL/TP set</div>`;
    return `<div class="tcard ${cls(p.profit)}" data-key="t${p.id}" data-trade="${p.id}">
      <div class="row between"><div class="row" style="gap:8px"><span class="side ${buy ? 'up' : 'down'}">${buy ? 'BUY' : 'SELL'}</span><b>${p.symbol}</b></div><span class="sub">${bot ? st.icon + ' ' + st.label : '✋ Manual'}</span></div>
      <div class="tpl mono ${cls(p.profit)}">${signed(p.profit)}</div>
      <div class="sub mono">${fmt(p.volume)} lot · ${px(p.symbol, p.openPrice)} → ${px(p.symbol, p.currentPrice)}</div>
      ${bar}
      <div class="row between" style="margin-top:10px"><span class="sub">⏱ ${age(p.time)} · <span class="linkbtn">Chart ›</span></span><button class="tclose" data-close="${p.id}">Close</button></div>
    </div>`;
  }
  function liveTradesHtml() {
    const ps = S.positions, n = ps.length, tot = ps.reduce((x, p) => x + p.profit, 0), botN = ps.filter(isBot).length;
    S.tradeIdx = Math.min(S.tradeIdx || 0, Math.max(0, n - 1));
    if (!n) return `${posHeader('Live trades')}<div class="card empty" style="padding:18px">No open trades. Trades from the bot and your manual orders appear here live.</div>`;
    return `${posHeader('Live trades · ' + n)}
      <div class="card livecard">
        <div class="row between lsum"><div><div class="sub">Floating P/L</div><div class="mono ${cls(tot)}" style="font-size:22px;font-weight:800">${signed(tot)}</div></div>
          <div class="right"><div class="sub">${ps.filter(p => p.type === 'POSITION_TYPE_BUY').length} buy · ${ps.filter(p => p.type !== 'POSITION_TYPE_BUY').length} sell</div><div class="sub">🤖 ${botN} bot · ✋ ${n - botN} manual</div></div></div>
        <div class="tslider" id="tslider">${ps.map(tradeCard).join('')}</div>
        ${n > 1 ? `<div class="tnav"><button class="tarrow" data-dir="-1" aria-label="Previous trade" ${S.tradeIdx === 0 ? 'disabled' : ''}>${icon('back')}</button>
          <div class="tdots">${ps.map((p, k) => `<i data-i="${k}" class="${k === S.tradeIdx ? 'on' : ''}"></i>`).join('')}<span class="mono">${S.tradeIdx + 1} / ${n}</span></div>
          <button class="tarrow next" data-dir="1" aria-label="Next trade" ${S.tradeIdx === n - 1 ? 'disabled' : ''}>${icon('back')}</button></div>` : ''}
      </div>`;
  }
  /* One-card trade carousel: swipe / arrows / dots; remembers the visible trade across live refreshes. */
  function bindTradeSlider(root) {
    const sl = $('#tslider', root); if (!sl) return;
    const go = k => { const n = sl.children.length; k = Math.max(0, Math.min(n - 1, k)); sl.scrollTo({ left: k * sl.clientWidth, behavior: 'smooth' }); };
    const sync = () => {
      const n = sl.children.length, k = Math.max(0, Math.min(n - 1, Math.round(sl.scrollLeft / Math.max(1, sl.clientWidth))));
      if (k === S.tradeIdx) return; S.tradeIdx = k;
      $$('.tdots i', root).forEach((d, i) => d.classList.toggle('on', i === k));
      const c = $('.tdots span', root); if (c) c.textContent = `${k + 1} / ${n}`;
      $$('.tarrow', root).forEach(b => b.disabled = (+b.dataset.dir < 0 ? k === 0 : k === n - 1));
    };
    if (!sl._bound) { sl._bound = true; sl.addEventListener('scroll', () => { S._slideAt = Date.now(); clearTimeout(sl._t); sl._t = setTimeout(sync, 60); }, { passive: true }); requestAnimationFrame(() => { sl.scrollLeft = (S.tradeIdx || 0) * sl.clientWidth; }); }
    $$('.tarrow', root).forEach(b => b.onclick = () => go(S.tradeIdx + +b.dataset.dir));
    $$('.tdots i', root).forEach(d => d.onclick = () => go(+d.dataset.i));
  }
  const isLive = () => S.conn.mode !== 'demo';
  const isBot = p => /^TB /.test(p.comment || '');
  const STRAT_CODE = { trend: 'T', breakout: 'B', reversion: 'R', sentiment: 'S' };
  const CODE_STRAT = { T: 'trend', B: 'breakout', R: 'reversion', S: 'sentiment' };
  const stratOf = p => CODE_STRAT[(p.comment || '').charAt(3)] || 'sentiment';
  const stratChip = k => `<span class="chip">${Engine.STRATEGIES[k].icon} ${Engine.STRATEGIES[k].label}</span>`;

  function gauge(score) {
    const ang = (score / 100) * 90; const col = score >= 25 ? 'var(--up)' : score <= -25 ? 'var(--down)' : 'var(--warn)';
    return `<svg class="gauge" viewBox="0 0 140 86"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="var(--warn)"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>
      <path d="M14 76 A56 56 0 0 1 126 76" stroke="url(#gg)" stroke-width="12" fill="none" stroke-linecap="round" opacity=".9"/>
      <g style="transform:rotate(${ang}deg);transform-origin:70px 76px;transition:transform .8s cubic-bezier(.2,.8,.2,1)"><line x1="70" y1="76" x2="70" y2="30" stroke="${col}" stroke-width="4" stroke-linecap="round"/></g>
      <circle cx="70" cy="76" r="7" fill="${col}"/><text x="70" y="62" text-anchor="middle" font-size="17" font-weight="800">${score > 0 ? '+' : ''}${score}</text></svg>`;
  }

  /* ---------- Markets ---------- */
  /* Markets: category filters, search, watch-list stars; only the rows on screen are analysed. */
  function viewMarkets(v) {
    const m = S.mkt ||= { cat: 'All', q: '', limit: 30 };
    const cat = S.catalog || watch().map(name => ({ name, cat: categorize(name), desc: '' }));
    const counts = {}; cat.forEach(r => counts[r.cat] = (counts[r.cat] || 0) + 1);
    const tabs = ['Watchlist', 'All', ...CATS.filter(c => counts[c])];
    const q = m.q.trim().toUpperCase();
    let list = m.cat === 'Watchlist' ? cat.filter(r => S.bot.symbols.includes(r.name)) : m.cat === 'All' ? cat : cat.filter(r => r.cat === m.cat);
    if (q) list = list.filter(r => r.name.toUpperCase().includes(q) || r.desc.toUpperCase().includes(q));
    const shown = list.slice(0, m.limit);
    const before = (S.marketVisible || []).join();
    S.marketVisible = shown.map(r => r.name);
    paint(v, `<div class="screen">${topbar('Markets')}
      <input class="input" id="mktq" type="search" placeholder="Search ${cat.length} symbols (e.g. gold, JPY, oil)" value="${esc(m.q)}" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <div class="tabs-mini cats" id="mcats">${tabs.map(c => `<button data-c="${c}" class="${m.cat === c ? 'on' : ''}">${c === 'Watchlist' ? '⭐ Watchlist' : c === 'All' ? 'All' : CAT_ICON[c] + ' ' + c}<span>${c === 'Watchlist' ? S.bot.symbols.length : c === 'All' ? cat.length : counts[c]}</span></button>`).join('')}</div>
      <div class="card" style="padding:6px 14px">${shown.map(r => { const s = r.name, a = S.analysis[s], on = S.bot.symbols.includes(s); return `<div class="list-item mrow" data-sym="${esc(s)}" data-key="${esc(s)}">
        <button class="star ${on ? 'on' : ''}" data-star="${esc(s)}" aria-label="${on ? 'Remove from' : 'Add to'} watch list">${on ? '★' : '☆'}</button>
        <div class="grow"><div class="title">${esc(s)} <span class="sub">${CAT_ICON[r.cat] || ''} ${esc(r.desc)}</span></div><div class="sub">${a ? `${Engine.REGIME_LABEL[a.regime]} · RSI ${fmt(a.rsi, 0)} · conf ${a.confidence}%` : 'Analysing…'}</div></div>
        <div class="right"><div class="mono title">${a ? px(s, a.price) : '—'}</div>${a ? `<span class="chip ${sentCls(a.score)}">${a.score > 0 ? '▲' : a.score < 0 ? '▼' : '•'} ${a.label}</span>` : ''}</div></div>`; }).join('') || `<div class="empty">${m.cat === 'Watchlist' ? 'Your watch list is empty. Tap ☆ on any symbol to add it.' : 'No symbols match.'}</div>`}
        ${list.length > shown.length ? `<button class="btn ghost" id="mmore" style="margin:10px 0">Show more (${list.length - shown.length})</button>` : ''}</div>
      <p class="hint" style="text-align:center">⭐ symbols are on the bot's watch list. Sentiment uses trend, RSI, MACD, rate of change, candle flow and mean reversion${S.newsKey ? ' plus live news' : ''}.</p>
    </div>`, 'markets');
    bindTop();
    const qi = $('#mktq'); qi.oninput = () => { m.q = qi.value; m.limit = 30; viewMarkets(v); clearTimeout(S._mktT); S._mktT = setTimeout(analyseAll, 400); };
    $$('#mcats button').forEach(b => b.onclick = () => { m.cat = b.dataset.c; m.limit = 30; viewMarkets(v); analyseAll(); });
    const more = $('#mmore'); if (more) more.onclick = () => { m.limit += 30; viewMarkets(v); analyseAll(); };
    $$('[data-star]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const s = b.dataset.star;
      if (S.bot.symbols.includes(s)) { S.bot.symbols = S.bot.symbols.filter(x => x !== s); toast(`${s} removed from watch list`); }
      else { S.bot.symbols = [...S.bot.symbols, s]; toast(`⭐ ${s} added to watch list`); }
      save(); viewMarkets(v);
    });
    $$('.mrow').forEach(r => r.onclick = () => openSymbol(r.dataset.sym));
    if (S.marketVisible.join() !== before && !S._mktPending) { S._mktPending = true; setTimeout(() => { S._mktPending = false; analyseAll(); }, 250); }
  }


  /* ===================== Trade journal & performance guardrails =====================
     Every trade gets a journal entry: why it was opened (strategy, market type, score, confidence,
     bigger-trend check, news) and, once closed, how it ended (P/L, R, exit reason, duration).
     Kept light on purpose:
       • Active journal: open trades + the most recent 300 closed ones (one small localStorage key).
       • Older closed trades move to an archive key in batches (max 3,000); beyond that the oldest are
         dropped but still counted in running totals per symbol / strategy, so long-run stats survive.
       • Nothing runs on the 1-second refresh except a check of the few open entries; stats and
         guardrails are recalculated only when a trade actually closes, and cached until the next one. */
  const J_ACTIVE = 300, J_ARCHIVE = 2000, J_BATCH = 100;
  const GUARD = { MIN: 30, NET_R: -5, PF: .8 };
  const J = { list: store.get('journal') || [], ver: 0, cache: {}, arcN: null };
  const arcCount = () => J.arcN ??= (store.get('journalArc') || []).length;
  /* Archived entries keep only what stats and the journal list need (about half the size). */
  const compact = e => ({ id: e.id, imp: e.imp, sym: e.sym, side: e.side, src: e.src, t: e.t, acct: e.acct, lot: e.lot, ctx: e.ctx && { strategy: e.ctx.strategy, regime: e.ctx.regime, score: e.ctx.score, conf: e.ctx.conf }, out: { t: e.out.t, profit: e.out.profit, r: e.out.r, why: e.out.why, mins: e.out.mins } });
  const acctKey = () => S.conn?.mode === 'demo' || !S.conn?.mode ? 'paper' : `${S.conn.mode}:${S.conn.login || S.conn.accountId || ''}`;
  function jSave() {
    J.ver++; J.cache = {};
    const closed = J.list.filter(e => e.out);
    if (closed.length > J_ACTIVE + J_BATCH) {                 // archive in batches, not on every close
      const move = new Set(closed.slice(0, closed.length - J_ACTIVE));
      const arc = store.get('journalArc') || [];
      arc.push(...J.list.filter(e => move.has(e)).map(compact));
      if (arc.length > J_ARCHIVE) {                           // roll the oldest into totals, then drop them
        const tot = store.get('journalTotals') || {};
        arc.splice(0, arc.length - J_ARCHIVE).forEach(e => ['sym:' + e.sym, 'strat:' + (e.ctx?.strategy || 'manual')].forEach(k => {
          const t = (tot[e.acct + '|' + k] ||= { n: 0, w: 0, r: 0, usd: 0 }); t.n++; if (e.out.profit > 0) t.w++; t.r += e.out.r || 0; t.usd += e.out.profit; }));
        store.set('journalTotals', tot);
      }
      store.set('journalArc', arc); J.arcN = arc.length; J.arcIds = null;
      J.list = J.list.filter(e => !move.has(e));
    }
    store.set('journal', J.list);
  }
  /* Remove one account's entries (active + archive), e.g. after a paper reset where trade ids start again. */
  function journalClear(acct) {
    J.list = J.list.filter(e => e.acct !== acct);
    const arc = (store.get('journalArc') || []).filter(e => e.acct !== acct); store.set('journalArc', arc); J.arcN = arc.length; J.arcIds = null; J.bfSig = null;
    const tot = store.get('journalTotals') || {}; Object.keys(tot).forEach(k => { if (k.startsWith(acct + '|')) delete tot[k]; }); store.set('journalTotals', tot);
    if (acct === acctKey() && S.bot.guard) { S.bot.guard.paused = {}; S.bot.guard.since = {}; save(); }
    jSave();
  }
  const journalSizeKb = () => Math.round(['journal', 'journalArc', 'journalTotals'].reduce((a, k) => a + (localStorage.getItem('tb_' + k)?.length || 0), 0) / 1024);
  /* Called right after an order is accepted. */
  function journalOpen({ id, sym, side, volume, entry, sl, tp, spec, src, ctx }) {
    let riskUsd = null;
    try { if (sl) riskUsd = Math.abs(entry - sl) * valuePerUnit(sym, spec, entry) * volume; } catch { }
    J.list.push({ id: id != null ? String(id) : null, sym, side, src, t: Date.now(), acct: acctKey(), entry, sl, tp, lot: volume, riskUsd: riskUsd ? +riskUsd.toFixed(2) : null, ctx });
    jSave();
  }
  /* On each refresh: link entries to their position ids, and close entries whose trade has closed.
     Only the open entries (a handful) are looked at; history is indexed once per refresh. */
  function journalReconcile() {
    const open = J.list.filter(e => !e.out && e.acct === acctKey()); if (!open.length) return;
    let changed = false;
    open.filter(e => !e.id).forEach(e => {
      const p = S.positions.find(x => x.symbol === e.sym && (x.type === 'POSITION_TYPE_BUY') === (e.side === 'BUY') && Math.abs((x.time || 0) - e.t) < 120000 && !J.list.some(o => o.id === String(x.id)));
      if (p) { e.id = String(p.id); changed = true; }
    });
    const live = new Set(S.positions.map(p => String(p.id)));
    const pending = open.filter(e => e.id && !live.has(e.id)); if (!pending.length) { if (changed) jSave(); return; }
    const deals = new Map(); (S.history || []).forEach(d => { if (!deals.has(String(d.id))) deals.set(String(d.id), d); });
    pending.forEach(e => {
      const d = deals.get(e.id); if (!d) return;
      e.out = { t: d.time, profit: +(+d.profit).toFixed(2), r: e.riskUsd ? +(d.profit / e.riskUsd).toFixed(2) : null, why: closeWhy(d), mins: Math.round((d.time - e.t) / 6e4) };
      changed = true;
      if (e.src === 'bot') log(`📓 ${e.sym} closed ${signed(d.profit)}${e.out.r != null ? ` (${e.out.r > 0 ? '+' : ''}${e.out.r}R)` : ''} · ${e.out.why}`, cls(d.profit));
    });
    if (changed) { jSave(); if (pending.some(e => e.out)) checkGuardrails(); }
  }
  /* Import closed trades that have no journal entry (e.g. opened before the journal existed, or on another
     device). Opening context is unknown except what the order comment holds ("TB T+40" → Trend, score +40),
     and R can't be worked out without the original stop, so they count for trades, win rate and $ only.
     Runs only when the history list actually changes; at most the 500 most recent closed trades. */
  function journalBackfill() {
    const h = S.history || [], sig = acctKey() + '|' + h.length + '|' + (h[0]?.id ?? '') + '|' + (h[0]?.time ?? '');
    if (J.bfSig === sig) return; J.bfSig = sig;
    const acct = acctKey();
    J.arcIds ??= new Set((store.get('journalArc') || []).map(e => e.acct + '|' + e.id));
    const known = new Set(J.list.map(e => e.acct + '|' + e.id));
    const add = h.slice(0, 500).filter(d => d.id != null && !known.has(acct + '|' + d.id) && !J.arcIds.has(acct + '|' + d.id));
    if (!add.length) return;
    add.reverse().forEach(d => {
      const c = d.comment || '', m = /^TB ([TBRS])([+-]\d+)?/.exec(c), bot = !!m || /^TBX Bot/.test(c);
      const t0 = d.openTime || d.time;
      J.list.push({ id: String(d.id), imp: true, sym: d.symbol, side: d.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL', src: bot ? 'bot' : 'manual', t: t0, acct, lot: d.volume, riskUsd: null,
        ctx: bot && m ? { strategy: CODE_STRAT[m[1]], score: m[2] != null ? +m[2] : null } : null,
        out: { t: d.time, profit: +(+d.profit).toFixed(2), r: null, why: closeWhy(d), mins: Math.max(0, Math.round((d.time - t0) / 6e4)) } });
    });
    J.list.sort((a, b) => (a.out?.t ?? 9e15) - (b.out?.t ?? 9e15));
    jSave(); log(`📓 Added ${add.length} earlier closed trade${add.length > 1 ? 's' : ''} to the journal`);
  }
  /* Stats over closed entries; cached per journal version. */
  function jStats(list) {
    const n = list.length, w = list.filter(e => e.out.profit > 0).length, rs = list.map(e => e.out.r).filter(x => x != null);
    const gain = rs.filter(x => x > 0).reduce((a, b) => a + b, 0), loss = -rs.filter(x => x < 0).reduce((a, b) => a + b, 0);
    return { n, rn: rs.length, win: n ? Math.round(w / n * 100) : 0, r: +rs.reduce((a, b) => a + b, 0).toFixed(1), avg: rs.length ? +(rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2) : 0,
      pf: loss ? +(gain / loss).toFixed(2) : gain ? Infinity : 0, usd: list.reduce((a, e) => a + e.out.profit, 0) };
  }
  const NEWS_BUCKET = e => e.ctx?.newsNext != null && e.ctx.newsNext < 240 ? 'High-impact news within 4 h' : 'No big news nearby';
  const GROUPS = { symbol: e => e.sym, strategy: e => e.src === 'manual' ? '✋ Manual' : (Engine.STRATEGIES[e.ctx?.strategy]?.label || e.ctx?.strategy || '—'), regime: e => e.ctx?.regime ? (Engine.REGIME_LABEL[e.ctx.regime] || e.ctx.regime) : '—', news: NEWS_BUCKET,
    protect: e => !e.ctx?.pm ? 'Not recorded' : e.ctx.pm === 'off' ? 'Off' : e.ctx.pm === 'standard' ? 'Standard' : e.ctx.pm.startsWith('keep:') ? (e.ctx.pm.split(':')[2] === 'prog' ? `Progressive ${({ '0.35': 'slower', '0.65': 'faster' })[e.ctx.pm.split(':')[3]] || 'normal'} (max ${Math.round(+e.ctx.pm.split(':')[1] * 100)}%)` : `Keep ${Math.round(+e.ctx.pm.split(':')[1] * 100)}% ${e.ctx.pm.split(':')[2] === 'entry' ? 'from entry' : 'from +1R'}`) : `Tight (${e.ctx.pm.split(':')[1]}R)` };
  function jGroups(by) {
    const key = by + J.ver + acctKey(); if (J.cache[key]) return J.cache[key];
    const all = J.list.filter(e => e.out && e.acct === acctKey()), g = {};
    all.forEach(e => (g[GROUPS[by](e)] ||= []).push(e));
    return (J.cache[key] = Object.entries(g).map(([k, l]) => [k, jStats(l)]).sort((a, b) => b[1].n - a[1].n));
  }
  /* Guardrails: pause a symbol or strategy that keeps losing. Never raises risk or changes settings. */
  function checkGuardrails() {
    const G = (S.bot.guard ||= { on: true, paused: {}, since: {} }); if (!G.on) return;
    const acct = acctKey(), bot = J.list.filter(e => e.out && e.src === 'bot' && e.acct === acct);
    const test = (key, label, pick) => {
      if (G.paused[key]) return;
      const l = bot.filter(e => pick(e) && e.out.t > (G.since[key] || 0)).slice(-GUARD.MIN);
      if (l.length < GUARD.MIN) return;
      const st = jStats(l);
      if (st.r <= GUARD.NET_R && st.pf < GUARD.PF) {
        G.paused[key] = { t: Date.now(), n: st.n, r: st.r, pf: st.pf, win: st.win }; save();
        const msg = `${label} paused: ${st.r}R over its last ${st.n} trades (${st.win}% won, profit factor ${st.pf}).`;
        log('🛡 ' + msg, 'down'); notify('Tradebot guardrail', msg + ' Resume it in Auto-Trade when you are ready.');
      }
    };
    [...new Set(bot.map(e => e.sym))].forEach(sy => test('sym:' + sy, sy, e => e.sym === sy));
    [...new Set(bot.map(e => e.ctx?.strategy).filter(Boolean))].forEach(st => test('strat:' + st, `${Engine.STRATEGIES[st]?.label || st} strategy`, e => e.ctx?.strategy === st));
  }
  const guardBlock = (sym, strat) => { const G = S.bot.guard; if (!G?.on) return null; return G.paused['sym:' + sym] ? ['sym:' + sym, sym] : strat && G.paused['strat:' + strat] ? ['strat:' + strat, `${Engine.STRATEGIES[strat]?.label} strategy`] : null; };
  function resumeGuard(key) { const G = S.bot.guard; delete G.paused[key]; G.since[key] = Date.now(); save(); log(`🛡 Resumed ${key.split(':')[1]}: counting its trades afresh`); }
  function guardCardHtml() {
    const G = S.bot.guard || {}, p = Object.entries(G.paused || {});
    if (!p.length) return '';
    return `<div class="notice" style="margin-bottom:12px"><b>🛡 Paused by guardrail</b>
      ${p.map(([k, v]) => `<div class="row between" style="margin-top:8px;gap:8px"><div><b>${k.startsWith('sym:') ? k.slice(4) : (Engine.STRATEGIES[k.slice(6)]?.label || k.slice(6)) + ' strategy'}</b><div class="sub">${v.r}R over ${v.n} trades · ${v.win}% won · since ${clock(v.t)}</div></div><button class="btn small ghost" data-resume="${k}">Resume</button></div>`).join('')}
      <div class="sub" style="margin-top:8px">The bot stops opening new trades on these. Open trades are not touched. Resume starts its count from zero.</div></div>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-resume]'); if (b) { resumeGuard(b.dataset.resume); if (S.tab === 'bot') viewBot($('#view')); else renderView(); } });
  /* Portfolio card: what is working and what is not. */
  function perfHtml() {
    const by = S.perfBy || 'symbol', rows = jGroups(by), n = rows.reduce((a, [, s]) => a + s.n, 0), G = S.bot.guard || {};
    const status = k => { const key = by === 'symbol' ? 'sym:' + k : by === 'strategy' ? 'strat:' + (Object.entries(Engine.STRATEGIES).find(([, v]) => v.label === k)?.[0] || '') : ''; return G.paused?.[key] ? '<span class="chip mini down">Paused</span>' : ''; };
    return `<div class="seg small" id="perfby">${[['symbol', 'Symbol'], ['strategy', 'Strategy'], ['regime', 'Market'], ['news', 'News'], ['protect', 'Protect']].map(([k, l]) => `<button data-b="${k}" class="${by === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${n ? `<div class="lvl head perf"><span>${({ symbol: 'Symbol', strategy: 'Strategy', regime: 'Market type', news: 'News', protect: 'Protect profits' })[by]}</span><span>Trades</span><span>Won</span><span>Net</span></div>
      ${rows.map(([k, st]) => `<div class="lvl perf"><span class="title" style="font-size:13px">${esc(k)} ${status(k)}</span><span class="mono">${st.n}${st.n < GUARD.MIN ? `<span class="sub">/${GUARD.MIN}</span>` : ''}</span><span class="mono">${st.win}%</span><span style="text-align:right"><b class="mono ${st.usd > 0 ? 'up' : st.usd < 0 ? 'down' : ''}">${signed(st.usd)}</b><br><span class="sub mono">${st.rn ? (st.r > 0 ? '+' : '') + st.r + 'R' : '—'}${st.rn && st.rn < st.n ? ` <span title="R known for ${st.rn} of ${st.n}">(${st.rn})</span>` : ''}</span></span></div>`).join('')}`
      : '<div class="sub" style="padding:12px 0">Closed trades appear here with why they were opened and how they ended.</div>'}
      <p class="hint">Net shows $ and R (result ÷ amount risked). Trades from before the journal existed are included for $ and win rate; their R is unknown, so the number in brackets is how many trades the R covers. Fewer than ${GUARD.MIN} trades in a row is too few to judge${acctKey() === 'paper' ? '. <b>Paper prices are random</b>, so these numbers say nothing about the strategy' : ''}.</p>
      <button class="btn ghost small" id="openjournal" style="margin-top:4px">Open trade journal</button>`;
  }
  function openJournal() {
    let shown = 50;
    const bg = sheet('<h2>Trade journal</h2><div id="jbody"></div>', null, 'journalsheet');
    const draw = () => {
      const all = J.list.filter(e => e.acct === acctKey()).slice().reverse(), arcN = (store.get('journalArc') || []).filter(e => e.acct === acctKey()).length;
      $('#jbody', bg).innerHTML = `<p class="sub" style="margin:-4px 0 10px">${all.length} recent${arcN ? ` · ${arcN} archived` : ''} · ${acctKey() === 'paper' ? 'Paper' : 'This MT5 account'}</p>
        ${all.slice(0, shown).map(e => { const c = e.ctx || {}, o = e.out;
          return `<div class="jrow"><div class="row between"><div><span class="side ${e.side === 'BUY' ? 'up' : 'down'}">${e.side}</span> <b>${e.sym}</b> <span class="sub">${fmt(e.lot)} lot · ${e.src === 'bot' ? '🤖' : '✋'} · ${clock(e.t)}</span></div>
            ${o ? `<b class="mono ${cls(o.profit)}">${signed(o.profit)}${o.r != null ? ` <span class="sub">${o.r > 0 ? '+' : ''}${o.r}R</span>` : ''}</b>` : '<span class="chip mini">Open</span>'}</div>
            <div class="sub" style="margin-top:4px">${e.imp ? `Added from history${e.src === 'bot' && c.strategy ? ` · ${Engine.STRATEGIES[c.strategy]?.label || c.strategy}${c.score != null ? ` · score ${c.score > 0 ? '+' : ''}${c.score}` : ''}` : e.src === 'bot' ? ' · bot trade' : ' · manual'} (opening details weren't recorded)` : e.src === 'bot' ? `${Engine.STRATEGIES[c.strategy]?.icon || ''} ${Engine.STRATEGIES[c.strategy]?.label || c.strategy || ''} · ${Engine.REGIME_LABEL[c.regime] || c.regime || '—'} · score ${c.score > 0 ? '+' : ''}${c.score} · ${c.conf}% conf${c.htf === true ? ' · with the bigger trend' : c.htf === false ? ' · against the bigger trend' : ''}${c.news != null ? ` · news ${c.news > 0 ? '+' : ''}${Math.round(c.news * 100)}` : ''}${c.newsNext != null && c.newsNext < 240 ? ` · big news in ${c.newsNext < 60 ? c.newsNext + 'm' : Math.round(c.newsNext / 60) + 'h'}` : ''}` : 'Manual order'}</div>
            ${o ? `<div class="sub">${o.why} after ${o.mins < 60 ? o.mins + 'm' : o.mins < 1440 ? Math.round(o.mins / 60) + 'h' : Math.round(o.mins / 1440) + 'd'}</div>` : ''}</div>`; }).join('') || '<div class="empty">No trades yet.</div>'}
        ${all.length > shown ? '<button class="btn ghost small" id="jmore" style="margin-top:10px">Show more</button>' : ''}`;
      const m = $('#jmore', bg); if (m) m.onclick = () => { shown += 50; draw(); };
    };
    draw();
  }
  const journalCtx = (sym, a, d) => {
    const ev = Brokers.Calendar.upcoming(Brokers.currenciesOf(sym), { from: Date.now(), impacts: ['High'] })[0];
    return { strategy: d?.strategy, regime: a?.regime, score: a?.score, conf: a?.confidence, htf: d ? htfOk(sym, d.action) : null,
      news: S.newsKey ? Brokers.News.forSymbol(sym, S.newsKey) ?? null : null, newsNext: ev ? Math.round((ev.time - Date.now()) / 6e4) : null,
      pm: !S.bot.trailing ? 'off' : S.bot.protectMode === 'tight' ? 'keep:' + (S.bot.keepPct || .9) + ':' + (S.bot.keepFrom || 'prog') + ((S.bot.keepFrom || 'prog') === 'prog' ? ':' + progSlope() : '') : 'standard' };
  };

  /* ---------- News & economic calendar ---------- */
  const relTime = t => { const m = Math.round((t - Date.now()) / 6e4), a = Math.abs(m), s = a < 60 ? `${a}m` : a < 1440 ? `${Math.floor(a / 60)}h${a % 60 ? ' ' + (a % 60) + 'm' : ''}` : `${Math.floor(a / 1440)}d`; return a < 1 ? 'now' : m > 0 ? `in ${s}` : `${s} ago`; };
  const clock = t => { const d = new Date(t), today = new Date().toDateString() === d.toDateString(); return (today ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' ') + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const watchCcys = () => [...new Set(watch().flatMap(Brokers.currenciesOf))];
  const evRow = e => `<div class="ev ${e.time < Date.now() ? 'past' : ''}"><span class="imp ${e.impact.toLowerCase()}" title="${e.impact} impact"></span>
    <div class="grow"><div class="title">${esc(e.title)} <span class="chip mini">${e.ccy}</span></div><div class="sub">${clock(e.time)} · ${relTime(e.time)}${e.forecast || e.previous ? ` · forecast ${esc(e.forecast || '—')} · prev ${esc(e.previous || '—')}` : ''}</div></div></div>`;
  const toneChip = (k, v) => v == null ? '' : `<span class="chip mini ${v > .1 ? 'up' : v < -.1 ? 'down' : 'neutral'}">${k} ${v > 0 ? '+' : ''}${Math.round(v * 100)}</span>`;
  function newsCardHtml() {
    const C = Brokers.Calendar, ccys = watchCcys(), up = C.upcoming(ccys, { from: Date.now() - 30 * 6e4 }).filter(e => e.time < Date.now() + 864e5).slice(0, 3);
    const paused = S.bot.newsPause ? watch().map(s => [s, C.blackout(s)]).filter(([, e]) => e) : [];
    const tone = S.newsKey ? ccys.map(c => toneChip(c, Brokers.News.score('FOREX:' + c))).join('') : '';
    return `<div class="row between"><h2 style="font-size:17px">News & events</h2><button class="sub linkbtn" data-news>All news ›</button></div>
      ${paused.length ? `<div class="notice" style="margin:10px 0">⏸ Bot is not opening trades on <b>${paused.map(([s]) => s).join(', ')}</b> around <b>${paused[0][1].ccy} ${esc(paused[0][1].title)}</b> (${clock(paused[0][1].time)}). It resumes 30 min after.</div>` : ''}
      ${up.length ? up.map(evRow).join('') : `<div class="sub" style="padding:10px 0">${C.data.events.length ? `No high- or medium-impact news for ${ccys.join(', ') || 'your symbols'} in the next 24 h.` : C.error ? 'Economic calendar unavailable right now.' : 'Loading economic calendar…'}</div>`}
      ${tone ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><span class="sub">News tone</span>${tone}</div>` : S.newsKey ? '' : `<div class="sub" style="margin-top:8px">Add a free news key in Profile → News to include headline sentiment.</div>`}`;
  }
  function openNews(tab = 'calendar', scope = 'mine') {
    const C = Brokers.Calendar, N = Brokers.News;
    const body = () => {
      if (tab === 'calendar') {
        const ev = C.upcoming(scope === 'mine' ? watchCcys() : null, { from: Date.now() - 6 * 36e5, impacts: ['High', 'Medium', 'Holiday'], limit: 200 });
        const days = {}; ev.forEach(e => (days[new Date(e.time).toDateString()] ||= []).push(e));
        return `<div class="seg" id="nscope" style="margin-bottom:10px"><button data-s="mine" class="${scope === 'mine' ? 'on' : ''}">My symbols (${watchCcys().join(', ')})</button><button data-s="all" class="${scope === 'all' ? 'on' : ''}">All currencies</button></div>
          ${Object.entries(days).map(([d, l]) => `<div class="sub daylbl">${new Date(l[0].time).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}</div>${l.map(evRow).join('')}`).join('') || '<div class="empty">No high- or medium-impact events left this week.</div>'}
          <p class="hint"><span class="imp high"></span> High impact: the bot pauses new trades 30 min before until 30 min after (if <i>Pause around news</i> is on). <span class="imp medium"></span> Medium impact is shown for information. Times are in your phone's time zone. Source: ForexFactory weekly calendar${C.data.t ? `, updated ${relTime(C.data.t)}` : ''}.</p>`;
      }
      if (!S.newsKey) return `<div class="empty">Headlines need a free Alpha Vantage key.<br>Add one in <b>Profile → News</b>.</div>`;
      const h = N.headlines(null, 40);
      return `${N.st.status ? `<div class="notice" style="margin-bottom:10px">${esc(N.st.status)}</div>` : ''}
        ${h.map(a => `<a class="headline" href="${esc(a.url)}" target="_blank" rel="noopener"><div class="title">${esc(a.title)}</div><div class="sub">${esc(a.source)} · ${relTime(a.time)} ${a.tick.slice(0, 3).map(t => toneChip(t.k.split(':')[1], Math.max(-1, Math.min(1, t.s / .35)))).join(' ')}</div></a>`).join('') || '<div class="empty">No headlines yet. They refresh every 90 minutes.</div>'}
        <p class="hint">Alpha Vantage news sentiment, last 24 h. The bot uses it as one factor (20% weight) in each symbol's score.</p>`;
    };
    const bg = sheet(`<h2>Market news</h2><div class="seg" id="ntab" style="margin:8px 0 12px"><button data-t="calendar" class="${tab === 'calendar' ? 'on' : ''}">Economic calendar</button><button data-t="headlines" class="${tab === 'headlines' ? 'on' : ''}">Headlines</button></div><div id="newsbody"></div>`, null, 'newssheet');
    const draw = () => { $('#newsbody', bg).innerHTML = body(); $$('#ntab button', bg).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
      $$('#nscope button', bg).forEach(b => b.onclick = () => { scope = b.dataset.s; draw(); }); };
    $$('#ntab button', bg).forEach(b => b.onclick = () => { tab = b.dataset.t; draw(); });
    draw();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-news]')) openNews(); });
  const symEventsHtml = sym => { const l = Brokers.Calendar.upcoming(Brokers.currenciesOf(sym), { from: Date.now() - 30 * 6e4 }).filter(e => e.time < Date.now() + 2 * 864e5).slice(0, 3);
    return l.length ? `<div class="card" style="background:var(--card2);margin-bottom:10px"><div class="row between"><div class="sub">Upcoming news for ${Brokers.currenciesOf(sym).join(' / ')}</div><button class="sub linkbtn" data-news>Calendar ›</button></div>${l.map(evRow).join('')}</div>` : ''; };

  /* ---------- Trade detail: chart with entry / SL / TP and projected P/L ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-trade]'); if (!t || e.target.closest('[data-close],[data-closeall],button:not(.linkbtn)')) return;
    if (Date.now() - (S._slideAt || 0) < 450) return;            // finger was swiping, not tapping
    openTrade(t.dataset.trade);
  });
  async function openTrade(id) {
    const p = S.positions.find(x => String(x.id) === String(id)); if (!p) return;
    $('#tradesheet')?.remove(); S.tradeId = String(id);
    const bg = sheet('<div id="tradebody"></div>', null, 'tradesheet');
    tradeSheetUpdate();
    S.specs ||= {};
    try {
      if (!S.specs[p.symbol]) S.specs[p.symbol] = await S.broker.getSpec(p.symbol);
      if (!S.candleCache[p.symbol]) S.candleCache[p.symbol] = await getSeries(p.symbol, S.bot.timeframe);
    } catch { }
    if (document.body.contains(bg)) tradeSheetUpdate();
  }
  function tradeSheetUpdate() {
    const body = $('#tradebody'); if (!body) return;
    const p = S.positions.find(x => String(x.id) === S.tradeId);
    if (!p) { paint(body, '<div class="empty" style="padding:30px 0">This trade has closed. See Portfolio → Closed trades.</div>', 'trade-closed'); setTimeout(() => { const bg = $('#tradesheet'); if (bg) closeSheet(bg); }, 1800); return; }
    const sym = p.symbol, dir = p.type === 'POSITION_TYPE_BUY' ? 1 : -1, buy = dir > 0, bot = isBot(p), st = bot ? Engine.STRATEGIES[stratOf(p)] : null;
    const spec = S.specs?.[sym], cur = p.currentPrice, diff = (cur - p.openPrice) * dir;
    // $ per 1.0 price move for this position: from the broker spec, else from the live P/L
    const perUnit = spec ? valuePerUnit(sym, spec, cur) * p.volume : Math.abs(diff) > 1e-12 ? p.profit / diff : null;
    const at = price => perUnit == null ? null : (price - p.openPrice) * dir * perUnit;
    const dg = spec?.digits ?? digits(sym), fx = categorize(sym) === 'Forex' && (dg === 5 || dg === 3);
    const dist = price => { const d = Math.abs(price - cur); return fx ? `${fmt(d * 10 ** (dg - 1), 1)} pips` : px(sym, d); };
    const tpUsd = p.takeProfit ? at(p.takeProfit) : null, slUsd = p.stopLoss ? at(p.stopLoss) : null;
    const meta = S.posMeta?.[p.id], riskUsd = meta?.r && perUnit != null ? meta.r * perUnit : slUsd != null && slUsd < 0 ? -slUsd : null;
    const locked = slUsd != null && slUsd >= 0;
    const prog = p.takeProfit ? clamp01((cur - p.openPrice) / (p.takeProfit - p.openPrice)) : null;
    let trail = '';
    if (bot && S.bot.trailing && S.bot.protectMode === 'tight' && (S.bot.keepFrom || 'prog') === 'prog' && riskUsd) {
      const cap = S.bot.keepPct || .9, gR = p.profit / riskUsd, f = keepShare(gR, cap), capAt = riskUsd * cap / progSlope(), spd = (PROG_SPEEDS.find(x => x[0] === progSlope()) || PROG_SPEEDS[1])[1].toLowerCase();
      trail = `<div class="protect"><div class="title">🔒 Protect profits · progressive (${spd})${locked ? ' · <span class="up">active</span>' : ''}</div>
        <div class="sub" style="margin-top:6px">The stop keeps a <b>growing share</b> of the profit: ${progSlope()} × the profit in R, up to ${Math.round(cap * 100)}% (reached at ${signed(capAt)}). It moves up only, never back.</div>
        <div class="keepbar"><i style="width:${(f / cap * 100).toFixed(0)}%"></i></div>
        <div class="sub">${p.profit > 0 ? `Now ${signed(p.profit)} → keeping <b>${Math.round(f * 100)}%</b> = <b class="up">${signed(p.profit * f)}</b>.` : `Now ${signed(p.profit)}: starts as soon as the trade is in profit.`}${locked ? (slUsd > p.profit * f + .01 ? ` The stop already locks <b class="up">${signed(slUsd)}</b> from when the price was higher; it never moves back.` : ` Stop locks <b class="up">${signed(slUsd)}</b>.`) : ''} Take-profit stays at ${p.takeProfit ? px(sym, p.takeProfit) : '—'}.</div></div>`;
    } else if (bot && S.bot.trailing && S.bot.protectMode === 'tight' && S.bot.keepFrom !== 'r1') {
      const keep = S.bot.keepPct || .9;
      trail = `<div class="protect"><div class="title">🔒 Protect profits · keep ${Math.round(keep * 100)}% from entry${locked ? ' · <span class="up">active</span>' : ''}</div>
        <div class="sub" style="margin-top:6px">From the first profit, the stop keeps <b>${Math.round(keep * 100)}% of the current profit</b> and moves up with it, never back.${p.profit > 0 ? ` Now ${signed(p.profit)} → keeps ${signed(p.profit * keep)}.` : ` Now ${signed(p.profit)}: starts as soon as the trade is in profit.`}${locked ? ` Stop locks <b class="up">${signed(slUsd)}</b>${Math.abs(slUsd - p.profit * keep) > Math.max(1, p.profit * .05) ? ' (catches up on the next refresh)' : ''}.` : ''} Take-profit stays at ${p.takeProfit ? px(sym, p.takeProfit) : '—'}.</div></div>`;
    } else if (bot && S.bot.trailing && riskUsd && S.bot.protectMode === 'tight') {
      const keep = S.bot.keepPct || .9, beAt = riskUsd * BE_R, kAt = riskUsd * TRAIL_R, st = locked ? (slUsd > riskUsd * .05 ? 2 : 1) : 0;
      trail = `<div class="protect"><div class="title">🔒 Protect profits · keep ${Math.round(keep * 100)}%${st ? ' · <span class="up">active</span>' : ''}</div>
        <div class="pstep ${st >= 1 ? 'done' : p.profit >= beAt ? 'now' : ''}"><b>1</b><span>At <b>${signed(beAt)}</b>: stop moves to <b>break-even</b>, so the trade can no longer lose.</span></div>
        <div class="pstep ${st >= 2 ? 'done' : ''}"><b>2</b><span>From <b>${signed(kAt)}</b>: stop keeps <b>${Math.round(keep * 100)}% of the current profit</b> and rises with it${p.profit >= kAt ? ` (now ${signed(p.profit)} → keeps ${signed(p.profit * keep)})` : ''}. It never moves back.</span></div>
        <div class="sub">${st === 2 ? `Now locking in <b class="up">${signed(slUsd)}</b>.` : st === 1 ? 'Stop is at break-even now.' : `Now ${signed(p.profit)}.`} Take-profit stays at ${p.takeProfit ? px(sym, p.takeProfit) : '—'}.</div></div>`;
    } else if (bot && S.bot.trailing && riskUsd) {
      const st = locked ? (slUsd > riskUsd * .05 ? 2 : 1) : 0, beAt = riskUsd * BE_R, trAt = riskUsd * TRAIL_R;
      trail = `<div class="protect"><div class="title">🔒 Protect profits${st ? ' · <span class="up">active</span>' : ''}</div>
        <div class="pstep ${st >= 1 ? 'done' : p.profit >= beAt ? 'now' : ''}"><b>1</b><span>At <b>${signed(beAt)}</b> (half the risk): stop moves to <b>break-even</b>, so the trade can no longer lose.</span></div>
        <div class="pstep ${st >= 2 ? 'done' : ''}"><b>2</b><span>At <b>${signed(trAt)}</b> (1× the risk): stop <b>follows the price ${signed(trAt).replace('+', '')} behind</b>, locking in more as it rises. It never moves back.</span></div>
        <div class="sub">${st === 2 ? `Now locking in <b class="up">${signed(slUsd)}</b>.` : st === 1 ? 'Stop is at break-even now.' : `Now ${signed(p.profit)}: ${p.profit >= beAt ? 'moving the stop on the next refresh.' : `stage 1 starts in ${signed(beAt - p.profit).replace('+', '')} more profit.`}`} The take-profit stays at ${p.takeProfit ? px(sym, p.takeProfit) : '—'}.</div></div>`;
    }
    const row = (lbl, cls2, price, usd, note) => `<div class="lvl"><span class="lvlname ${cls2}">${lbl}</span><span class="mono">${price != null ? px(sym, price) : '—'}</span><span class="sub mono">${note || ''}</span><b class="mono ${usd == null ? '' : cls(usd)}">${usd == null ? '—' : signed(usd)}</b></div>`;
    paint(body, `<div class="row between"><div class="row" style="gap:8px"><span class="side ${buy ? 'up' : 'down'}">${buy ? 'BUY' : 'SELL'}</span><h2 style="margin:0">${sym}</h2></div><span class="sub">${bot ? st.icon + ' ' + st.label : '✋ Manual'} · ⏱ ${age(p.time)}</span></div>
      <div class="row between" style="margin-top:6px"><div class="tpl mono ${cls(p.profit)}" style="margin:0">${signed(p.profit)}</div><span class="sub mono">${fmt(p.volume)} lot</span></div>
      <div class="chart-box" style="margin:10px 0"><canvas id="tradechart" height="250"></canvas></div>
      <div class="card lvls" style="background:var(--card2)">
        <div class="lvl head"><span>Level</span><span>Price</span><span>From now</span><span>P/L there</span></div>
        ${row('🎯 Take-profit', 'up', p.takeProfit, tpUsd, p.takeProfit ? dist(p.takeProfit) : 'not set')}
        ${row('● Now', '', cur, p.profit, '')}
        ${row('▶ Entry', 'muted', p.openPrice, 0, dist(p.openPrice))}
        ${row(locked ? '🔒 Stop (locked)' : '🛑 Stop-loss', locked ? 'up' : 'down', p.stopLoss, slUsd, p.stopLoss ? dist(p.stopLoss) : 'not set')}
      </div>
      <div class="grid3" style="margin-top:10px">
        <div class="stat"><div class="lbl">To target</div><div class="val">${prog == null ? '—' : Math.round(prog * 100) + '%'}</div></div>
        <div class="stat"><div class="lbl">Reward : risk</div><div class="val">${tpUsd != null && riskUsd ? fmt(tpUsd / riskUsd, 1) + ' : 1' : '—'}</div></div>
        <div class="stat"><div class="lbl">Now in R</div><div class="val mono ${cls(p.profit)}">${riskUsd ? (p.profit >= 0 ? '+' : '') + fmt(p.profit / riskUsd, 2) + 'R' : '—'}</div></div></div>
      ${(() => { const j = J.list.find(e => e.id === String(p.id)), c = j?.ctx; return j && j.src === 'bot' && c ? `<p class="hint" style="margin-top:10px">📓 <b>Why the bot took it:</b> ${Engine.STRATEGIES[c.strategy]?.label || c.strategy} strategy in a ${(Engine.REGIME_LABEL[c.regime] || c.regime || '').toLowerCase()} market · score ${c.score > 0 ? '+' : ''}${c.score} · ${c.conf}% confidence${c.htf === true ? ' · with the bigger trend' : ''}${c.newsNext != null && c.newsNext < 240 ? ` · big news was ${c.newsNext}m away` : ''}.</p>` : ''; })()}
      ${trail}
      ${(() => { const e = Brokers.Calendar.upcoming(Brokers.currenciesOf(sym), { from: Date.now() - 15 * 6e4, impacts: ['High'] }).find(x => x.time < Date.now() + 2 * 36e5); return e ? `<div class="notice" style="margin-top:10px">⚠ <b>${e.ccy} ${esc(e.title)}</b> ${relTime(e.time)} (${clock(e.time)}). High-impact news can make the price jump past a stop-loss or take-profit.</div>` : ''; })()}
      <p class="hint">P/L at each level is projected from the current price and lot size. Spread, commission and swap are not included${p.swap ? ` (swap so far ${signed(p.swap)})` : ''}.</p>
      <div class="grid2" style="margin-top:6px"><button class="btn ghost" id="tsym">Analysis & new order</button><button class="btn danger" data-close="${p.id}">Close trade</button></div>`, 'trade:' + p.id);
    bindPositions(body);
    const ts = $('#tsym', body); if (ts) ts.onclick = () => { closeSheet($('#tradesheet')); setTimeout(() => openSymbol(sym), 260); };
    const lv = [];
    if (p.takeProfit) lv.push({ price: p.takeProfit, label: `TP ${tpUsd != null ? signed(tpUsd) : ''}`, color: '--up', dash: true });
    lv.push({ price: p.openPrice, label: 'Entry', color: '--muted' });
    if (p.stopLoss) lv.push({ price: p.stopLoss, label: `${locked ? 'Stop 🔒' : 'SL'} ${slUsd != null ? signed(slUsd) : ''}`, color: locked ? '--up' : '--down', dash: true });
    drawChart($('#tradechart', body), sym, lv);
  }
  function openSymbol(sym) {
    S.focus = sym;
    const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'symsheet';
    bg.innerHTML = `<div class="sheet"><div class="grip"></div><div id="symbody"></div></div>`;
    document.body.appendChild(bg); attachSheet(bg); symbolSheetUpdate(true);
    S.specs ||= {};
    const fillSugg = () => { const a = S.analysis[sym], li = $('#lot'); if (li && a && S.bot.targetMode === 'usd' && S.specs[sym] && document.activeElement !== li) li.value = fmt(usdPlan(sym, a, S.specs[sym], S.bot.tpAtr).lot); };
    if (S.specs[sym]) fillSugg();
    else S.broker?.getSpec(sym).then(sp => { S.specs[sym] = sp; symbolSheetUpdate(); fillSugg(); }).catch(() => { });
  }
  function symbolSheetUpdate(first) {
    const sym = S.focus, a = S.analysis[sym], body = $('#symbody'); if (!body) return;
    const usd = S.bot.targetMode === 'usd', sp = S.specs?.[sym];
    const sugg = usd && a && sp ? usdPlan(sym, a, sp, S.bot.tpAtr).lot : null;
    const lot = $('#lot')?.value || (sugg != null ? fmt(sugg) : '0.10');
    paint(body, `<div class="row between"><div><h2>${sym}</h2><div class="sub mono">${a ? px(sym, a.price) : '—'} · ATR ${a ? px(sym, a.atr) : '—'}</div></div>
      ${a ? `<span class="chip ${sentCls(a.score)}">${a.score > 0 ? '+' : ''}${a.score} · ${a.label}</span>` : ''}</div>
      <div class="chart-box" style="margin:12px 0"><canvas id="symchart" height="230"></canvas></div>
      ${a ? (() => { const d = botDecision(sym)[1]; return `<div class="card row between" style="background:var(--card2);margin-bottom:10px"><div><div class="sub">${Engine.REGIME_LABEL[a.regime]} market · ${S.bot.strategy === 'auto' ? 'Auto picks' : 'Strategy'}</div><div class="title">${Engine.STRATEGIES[d.strategy].icon} ${Engine.STRATEGIES[d.strategy].label} <span class="sub">${esc(d.why)}</span></div></div><span class="chip ${d.action === 'BUY' ? 'up' : d.action === 'SELL' ? 'down' : 'neutral'}">${d.action}</span></div>`; })() : ''}
      ${symEventsHtml(sym)}
      ${a ? `<div class="grid3" style="margin-bottom:10px"><div class="stat"><div class="lbl">Signal</div><div class="val ${a.signal === 'BUY' ? 'up' : a.signal === 'SELL' ? 'down' : ''}">${a.signal}</div></div>
        <div class="stat"><div class="lbl">Confidence</div><div class="val">${a.confidence}%</div></div><div class="stat"><div class="lbl">RSI</div><div class="val">${fmt(a.rsi, 1)}</div></div></div>
        <div class="card" style="background:var(--card2)">${a.factors.map(f => `<div class="factor"><span class="muted">${f.key}</span><div class="bar"><i style="left:${f.v < 0 ? 50 + f.v / 2 : 50}%;width:${Math.abs(f.v) / 2}%;background:${f.v >= 0 ? 'var(--up)' : 'var(--down)'}"></i><i style="left:50%;width:1px;background:var(--muted)"></i></div><span class="mono right ${cls(f.v)}">${f.v > 0 ? '+' : ''}${f.v}</span></div>`).join('')}</div>` : '<div class="empty">Analysing…</div>'}
      <div class="field"><label>Lot size</label><input class="input mono" id="lot" type="number" step="0.01" min="0.01" value="${lot}"></div>
      <div class="grid2"><button class="btn" style="background:var(--up)" data-side="BUY">Buy</button><button class="btn danger" data-side="SELL">Sell</button></div>
      <p class="hint">${usd ? `Fixed targets: <b class="up">+$${fmt(S.bot.tpUsd)}</b> / <b class="down">−$${fmt(S.bot.slUsd)}</b> per trade (Auto-Trade settings).${sugg != null ? ` Lot that fits ${sym}: <b>${fmt(sugg)}</b> <button class="linkbtn" id="usesugg" data-l="${fmt(sugg)}">Use</button>` : ''}` : `Stop-loss / take-profit are set from ATR × ${S.bot.slAtr} / ${S.bot.tpAtr} (Auto-Trade settings).`}</p>`, 'sym:' + sym);
    const us = $('#usesugg', body); if (us) us.onclick = () => { $('#lot').value = us.dataset.l; };
    $$('[data-side]', body).forEach(b => b.onclick = () => manualTrade(sym, b.dataset.side, +$('#lot').value));
    drawChart($('#symchart'), sym);
  }
  async function manualTrade(sym, side, volume) {
    if (!(volume > 0)) return toast('Enter a lot size');
    let opt = {};
    if (S.bot.targetMode === 'usd') {
      const f = await usdFit(sym, volume).catch(() => null);
      if (f?.tight) {
        const dp = digits(sym);
        const why = `At <b>${fmt(volume)} lot</b>, a ±$${fmt(Math.min(S.bot.tpUsd, S.bot.slUsd))} target is only <b>${fmt(f.dist, dp)}</b> from the entry, less than 3× the current spread (${fmt(f.spread, dp)}). Normal price noise would close it almost at once.`;
        if (f.suggestedOk && f.suggested !== volume) {
          if (!(await ask({ title: 'Target too close for this lot', message: `${why}<br><br>Use <b>${fmt(f.suggested)} lot</b> instead to keep +$${fmt(S.bot.tpUsd)} / −$${fmt(S.bot.slUsd)}.`, ok: `Use ${fmt(f.suggested)} lot`, ic: 'chart' }))) return;
          volume = f.suggested; const li = $('#lot'); if (li) li.value = fmt(volume);
        } else {
          if (!(await ask({ title: 'Target too close for this lot', message: `${why}<br><br>Place this trade with volatility-based stops instead (ATR × ${S.bot.slAtr} / ${S.bot.tpAtr})?`, ok: 'Use ATR stops', ic: 'chart' }))) return;
          opt = { forceAtr: true };
        }
      }
    }
    if (isLive() && !(await ask({ title: `Place live ${side.toLowerCase()} order?`, message: `<b>${side} ${volume} lot ${sym}</b> at market on your MT5 account. Stop-loss and take-profit are set automatically.`, ok: `${side} ${sym}`, tone: side === 'BUY' ? 'up' : 'danger', ic: 'chart' }))) return;
    try { await placeOrder(sym, side, volume, 'Manual', opt); toast(`${side} ${volume} ${sym} placed`); $('#symsheet')?.remove(); poll(); }
    catch (e) { toast('Order failed: ' + e.message); }
  }

  /* ---------- Auto-trade ---------- */
  function viewBot(v) {
    const b = S.bot, all = S.allSymbols || Object.keys(Brokers.SPECS);
    v.innerHTML = `<div class="screen">${topbar('Auto-Trade')}
      <div class="card" id="botstat" data-view="bot">${botStatusHtml()}</div>
      ${isLive() ? '<div class="notice" style="margin-bottom:12px"><b>Live account.</b> The bot places real orders with real money. Automated strategies can and do lose. Start small and watch it closely.</div>' : ''}
      <h3>Strategy radar</h3><div id="datahealth" style="margin:-4px 0 8px">${dataHealthHtml()}</div><div class="card" id="radar" data-view="radar">${radarHtml()}</div>
      <div class="card tested" id="tested" data-view="tested">${testedHtml()}</div>
      ${guardCardHtml()}
      <div class="lockbar ${S.settingsUnlocked ? 'open' : ''}" id="lockbar"><div><b id="lockt">${S.settingsUnlocked ? '🔓 Editing settings' : '🔒 Settings locked'}</b><div class="sub" id="locks">${S.settingsUnlocked ? 'Lock again when you are done' : 'Prevents accidental changes while scrolling'}</div></div><button class="btn small ${S.settingsUnlocked ? '' : 'ghost'}" id="lockbtn">${S.settingsUnlocked ? 'Lock' : 'Unlock to edit'}</button></div>
      <div id="botsettings" class="${S.settingsUnlocked ? '' : 'locked'}">
      <div class="${atLeast('moderate') ? '' : 'hidden'}"><h3>Strategy</h3><div class="strat-grid" id="strat">${Object.entries(Engine.STRATEGIES).map(([k, st]) => `<button data-st="${k}" class="strat ${b.strategy === k ? 'on' : ''}"><span class="em">${st.icon}</span><b>${st.label}</b><small>${st.desc}</small></button>`).join('')}</div></div>
      <h3>Risk profile</h3><div class="seg" id="preset">${Object.entries(RISK_PRESETS).map(([k, p]) => `<button data-k="${k}" class="${b.profile === k ? 'on' : ''} ${k === 'aggressive' && !atLeast('moderate') ? 'hidden' : ''}">${p.label}</button>`).join('')}</div>
      <p class="hint">${presetHint()}</p>
      <h3>Symbols</h3><div class="tabs-mini" style="flex-wrap:wrap" id="syms">${[...new Set([...b.symbols, ...all])].slice(0, 40).map(s => `<button data-s="${s}" class="${b.symbols.includes(s) ? 'on' : ''}">${s}</button>`).join('')}</div>
      <div class="${atLeast('moderate') ? '' : 'hidden'}"><h3>Strategy settings</h3><div class="card">
        <div class="field"><label>Timeframe</label><div class="seg" id="tf">${['5m', '15m', '1h', '4h'].map(t => `<button data-t="${t}" class="${b.timeframe === t ? 'on' : ''} ${t === '5m' && !atLeast('pro') ? 'hidden' : ''}">${t}</button>`).join('')}</div>
          <p class="hint" id="tfhint">${tfHint()}</p></div>
        <div class="${atLeast('pro') ? '' : 'hidden'}">
        ${slider('threshold', 'Entry sentiment threshold', 15, 80, 1, '±')}
        ${slider('minConfidence', 'Minimum confidence', 20, 90, 1, '', '%')}
        ${slider('slAtr', 'Stop-loss (× ATR)', .5, 5, .1)}
        ${slider('tpAtr', 'Take-profit (× ATR)', .5, 8, .1)}</div>
        <div class="row between" style="margin-bottom:14px"><div><div class="title">Follow the bigger trend</div><div class="sub" id="htfsub">Only buy when the ${HTF[b.timeframe]} trend is up, only sell when it is down</div></div><label class="toggle"><input type="checkbox" id="htf" ${b.htfFilter ? 'checked' : ''}><span></span></label></div>
        <div class="row between" style="margin-bottom:14px"><div><div class="title">Guardrails: pause what keeps losing</div><div class="sub">If a symbol or strategy loses ${Math.abs(GUARD.NET_R)}R or more over its last ${GUARD.MIN} bot trades (profit factor under ${GUARD.PF}), stop opening trades on it and tell you. Never raises risk.</div></div><label class="toggle"><input type="checkbox" id="guardon" ${S.bot.guard?.on !== false ? 'checked' : ''}><span></span></label></div>
        <div class="row between" style="margin-bottom:14px"><div><div class="title">Pause around high-impact news</div><div class="sub">No new trades from 30 min before until 30 min after big news for the symbol's currencies (rate decisions, CPI, jobs reports)</div></div><label class="toggle"><input type="checkbox" id="npause" ${b.newsPause ? 'checked' : ''}><span></span></label></div>
        <div class="row between" style="margin-bottom:14px"><div><div class="title">Protect profits</div><div class="sub">Moves the stop-loss up as a trade gains, so profit is locked in. ${b.protectMode === 'tight' ? 'Keeping a % of profit (below).' : 'Standard: at half the risk in profit the stop goes to break-even; at 1× the risk it trails the price by that amount.'}</div></div><label class="toggle"><input type="checkbox" id="trail" ${b.trailing ? 'checked' : ''}><span></span></label></div>
        <div class="${b.trailing ? '' : 'hidden'}" id="pmodebox" style="margin:-4px 0 14px">
          <div class="seg small" id="pmode"><button data-m="standard" class="${b.protectMode !== 'tight' ? 'on' : ''}">Standard (tested best)</button><button data-m="tight" class="${b.protectMode === 'tight' ? 'on' : ''}">Keep % of profit</button></div>
          <div class="${b.protectMode === 'tight' ? '' : 'hidden'}" id="tightbox"><div class="seg small" id="keeppct" style="margin-top:8px">${[.7, .8, .9].map(x => `<button data-k="${x}" class="${(b.keepPct || .9) === x ? 'on' : ''}">${(b.keepFrom || 'prog') === 'prog' ? 'Up to' : 'Keep'} ${Math.round(x * 100)}%</button>`).join('')}</div>
          <div class="seg small" id="keepfrom" style="margin-top:8px"><button data-f="prog" class="${(b.keepFrom || 'prog') === 'prog' ? 'on' : ''}">Progressive</button><button data-f="entry" class="${b.keepFrom === 'entry' ? 'on' : ''}">From entry</button><button data-f="r1" class="${b.keepFrom === 'r1' ? 'on' : ''}">From +1R</button></div>
          ${(b.keepFrom || 'prog') === 'prog' ? `<div class="seg small" id="progspeed" style="margin-top:8px">${PROG_SPEEDS.map(([k, l]) => `<button data-s="${k}" class="${progSlope() === k ? 'on' : ''}">${l} lock</button>`).join('')}</div>` : ''}
          <p class="hint">${(b.keepFrom || 'prog') === 'prog' ? (() => { const c = b.keepPct || .9, sp = PROG_SPEEDS.find(x => x[0] === progSlope()) || PROG_SPEEDS[1], ex = [.18, .5, 1, 1.44, 2].map(g => `+$${Math.round(28.49 * g)} → ${Math.round(keepShare(g, c) * 100)}%`).join(', ');
              return `From the first profit, the stop keeps a <b>growing share</b> of it: ${sp[0]} × the profit in R, up to <b>${Math.round(c * 100)}%</b> (reached at +${fmt(c / sp[0], 2)}R). Never moves back. On a $28.49-risk trade: ${ex}. <b>${sp[1]} lock</b> tested at <b>${sp[2]}</b>${sp[0] === .65 ? ' (wins more often, but less in total; weaker in the later period)' : sp[0] === .35 ? ' (more room, fewer but bigger wins)' : ''}. Other speeds: ${PROG_SPEEDS.filter(x => x !== sp).map(x => `${x[1]} ${x[2]}`).join(', ')}; Standard +52R / +18R.`; })()
            : b.keepFrom !== 'r1' ? `From the first profit the stop keeps <b>${Math.round((b.keepPct || .9) * 100)}% of the current profit</b> and rises with it, never back: at +$5 it locks ${signed(5 * (b.keepPct || .9))}, at +$41 about ${signed(41 * (b.keepPct || .9))}. <span class="down">In testing this lost money</span> (about −100R where Standard made +52R): small pullbacks close most trades at tiny gains while losing trades stay full size.`
            : `At +0.5R the stop goes to break-even. From +1R it keeps <b>${Math.round((b.keepPct || .9) * 100)}% of the current profit</b>: at +$41 it locks about ${signed(41 * (b.keepPct || .9))}. Tested: +44R / +17R against +52R / +18R for Standard.`} Compare in Portfolio → Bot performance → Protect.</p></div></div>
        <div class="row between"><div><div class="title">Exit when sentiment flips</div><div class="sub">Close a bot trade when sentiment turns strongly against it (after ${FLIP_MIN_BARS}+ candles)</div></div><label class="toggle"><input type="checkbox" id="flip" ${b.exitOnFlip ? 'checked' : ''}><span></span></label></div>
      </div></div>
      <div class="${atLeast('moderate') ? '' : 'hidden'}">
      <h3>Profit & loss targets</h3><div class="card" id="targets">
        <div class="seg" id="tmode" style="margin-bottom:12px"><button data-m="atr" class="${b.targetMode === 'atr' ? 'on' : ''}">By volatility (ATR)</button><button data-m="usd" class="${b.targetMode === 'usd' ? 'on' : ''}">Fixed $ amount</button></div>
        <div id="t_usd" class="${b.targetMode === 'usd' ? '' : 'hidden'}">
          <div class="grid2"><div class="field"><label>Take-profit per trade</label><div class="money"><span>+$</span><input class="input mono" type="number" inputmode="decimal" min="0.5" step="0.5" data-usd="tpUsd" value="${b.tpUsd}"></div></div>
          <div class="field"><label>Stop-loss per trade</label><div class="money"><span>−$</span><input class="input mono" type="number" inputmode="decimal" min="0.5" step="0.5" data-usd="slUsd" value="${b.slUsd}"></div></div></div>
          <p class="hint" style="margin-top:-4px" id="t_hint">${targetHint()}</p>
        </div>
        <p class="hint ${b.targetMode === 'atr' ? '' : 'hidden'}" id="t_atr">Stop-loss and take-profit follow market volatility (ATR multiples set under Strategy). Lot size comes from <b>Risk per trade</b>.</p>
        <div class="grid2" style="margin-top:12px"><div class="field"><label>Basket take-profit</label><div class="money"><span>+$</span><input class="input mono" type="number" inputmode="decimal" min="0" step="1" data-usd="basketTp" value="${b.basketTp}"></div></div>
          <div class="field"><label>Basket stop-loss</label><div class="money"><span>−$</span><input class="input mono" type="number" inputmode="decimal" min="0" step="1" data-usd="basketSl" value="${b.basketSl}"></div></div></div>
        <p class="hint" style="margin-top:-4px">Closes <b>all bot trades together</b> when their combined profit or loss reaches the amount. Set 0 to turn off.</p>
      </div>
      <h3>Money management</h3><div class="card">
        ${slider('riskPct', 'Risk per trade (ATR mode)', .1, 5, .1, '', '% of equity')}
        ${slider('maxPositions', 'Max open positions', 1, 10, 1)}
        ${slider('dailyLossPct', 'Daily loss limit (bot pauses)', .5, 20, .5, '-', '%')}
        ${slider('maxLot', 'Max lot per trade', .01, 10, .01)}
        <div class="${atLeast('pro') ? '' : 'hidden'}">${slider('intervalSec', 'Scan interval', 5, 300, 5, '', ' s')}
        <p class="hint" style="margin-top:-4px">How often the bot checks for a newly closed candle. It trades at most once per candle, so a shorter interval does not mean more trades.</p></div>
      </div></div>
      ${atLeast('moderate') ? '' : `<p class="hint" style="margin-top:14px">🌱 Beginner mode shows only the tested presets. More settings appear at <b>Moderate</b> or <b>Pro trader</b> level (Profile → Trading experience).</p>`}
      </div>
      <h3>Activity log</h3><div class="card log" id="botlog">${logHtml()}</div>
      <button class="btn ghost" id="clearlog">Clear log</button>
    </div>`;
    bindTop();
    $('#bottoggle').onchange = e => toggleBot(e.target.checked);
    $$('#strat button').forEach(x => x.onclick = () => { b.strategy = x.dataset.st; save(); $$('#strat button').forEach(y => y.classList.toggle('on', y === x)); paint($('#radar'), radarHtml(), 'radar'); log(`Strategy set to ${Engine.STRATEGIES[b.strategy].label}`); });
    bindPositions(v);
    $$('#preset button').forEach(x => x.onclick = () => { applyTested(x.dataset.k); save(); S.candleCache = {}; resetSeries(); analyseAll(); viewBot(v); toast(`${RISK_PRESETS[x.dataset.k].label} profile applied`); });
    $$('#syms button').forEach(x => x.onclick = () => { const s = x.dataset.s; b.symbols = b.symbols.includes(s) ? b.symbols.filter(y => y !== s) : [...b.symbols, s]; x.classList.toggle('on'); save(); });
    $$('#tf button').forEach(x => x.onclick = () => { b.timeframe = x.dataset.t; b.profile = 'custom'; $$('#preset button').forEach(y => y.classList.remove('on')); $$('#tf button').forEach(y => y.classList.toggle('on', y === x)); $('#tfhint').innerHTML = tfHint(); $('#htfsub').textContent = `Only buy when the ${HTF[b.timeframe]} trend is up, only sell when it is down`; S.candleCache = {}; resetSeries(); save(); analyseAll(); });
    $('#guardon').onchange = e => { (S.bot.guard ||= { on: true, paused: {}, since: {} }).on = e.target.checked; save(); if (e.target.checked) checkGuardrails(); };
    $('#npause').onchange = e => { b.newsPause = e.target.checked; save(); log(b.newsPause ? 'Pause around high-impact news: on' : 'Pause around high-impact news: off'); };
    $$('#pmode button').forEach(x => x.onclick = async () => {
      if (x.dataset.m === 'tight' && b.protectMode !== 'tight' && !(await ask({ title: 'Keep a % of profit?', message: 'The stop keeps a share of the current profit and rises with it. Progressive (the default here) keeps a growing share and tested at +33R / +14R; a flat 90% from entry lost money; Standard made the most (+52R / +18R).', ok: 'Use it', ic: 'shield' }))) return;
      b.protectMode = x.dataset.m; save(); log(`Protect profits mode: ${b.protectMode === 'tight' ? `keep ${Math.round((b.keepPct || .9) * 100)}% of profit` : 'Standard'}`); viewBot(v); });
    $$('#keeppct button').forEach(x => x.onclick = () => { b.keepPct = +x.dataset.k; save(); viewBot(v); });
    $$('#progspeed button').forEach(x => x.onclick = () => { b.progSpeed = +x.dataset.s; save(); log(`Progressive lock speed: ${(PROG_SPEEDS.find(y => y[0] === b.progSpeed) || [])[1]} (${b.progSpeed} × profit in R)`); viewBot(v); });
    $$('#keepfrom button').forEach(x => x.onclick = () => { b.keepFrom = x.dataset.f; b.kfV = 2; save(); log(`Keep % of profit: ${({ prog: `progressive, up to ${Math.round((b.keepPct || .9) * 100)}%`, entry: `${Math.round((b.keepPct || .9) * 100)}% from entry`, r1: 'after break-even, from +1R' })[b.keepFrom]}`); viewBot(v); });
    $('#trail').onchange = e => { b.trailing = e.target.checked; $('#pmodebox').classList.toggle('hidden', !b.trailing); save(); log(b.trailing ? 'Protect profits on (trailing stop)' : 'Protect profits off'); };
    $('#htf').onchange = e => { b.htfFilter = e.target.checked; save(); analyseAll(); };
    bindTested(v);
    $$('input[data-k]').forEach(inp => inp.oninput = () => { b[inp.dataset.k] = +inp.value; b.profile = 'custom'; $$('#preset button').forEach(y => y.classList.remove('on')); $(`#v_${inp.dataset.k}`).textContent = inp.dataset.pre + inp.value + inp.dataset.suf; save(); });
    $('#flip').onchange = e => { b.exitOnFlip = e.target.checked; save(); };
    $('#lockbtn').onclick = async () => {
      const open = !S.settingsUnlocked;
      if (open && isLive() && S.profile.biometric && !(await Security.verify('Unlock bot settings'))) return;
      S.settingsUnlocked = open; $('#botsettings').classList.toggle('locked', !open); $('#lockbar').classList.toggle('open', open);
      $('#lockt').textContent = open ? '🔓 Editing settings' : '🔒 Settings locked'; $('#locks').textContent = open ? 'Lock again when you are done' : 'Prevents accidental changes while scrolling';
      $('#lockbtn').textContent = open ? 'Lock' : 'Unlock to edit'; $('#lockbtn').classList.toggle('ghost', !open);
      clearTimeout(S._relockT); if (open) S._relockT = setTimeout(() => { if (S.settingsUnlocked && S.tab === 'bot') $('#lockbtn')?.click(); else S.settingsUnlocked = false; }, 120000);
    };
    $$('#tmode button').forEach(x => x.onclick = () => { b.targetMode = x.dataset.m; save(); $$('#tmode button').forEach(y => y.classList.toggle('on', y === x)); $('#t_usd').classList.toggle('hidden', b.targetMode !== 'usd'); $('#t_atr').classList.toggle('hidden', b.targetMode !== 'atr'); paint($('#radar'), radarHtml(), 'radar'); log(b.targetMode === 'usd' ? `Fixed targets on: +$${fmt(b.tpUsd)} / −$${fmt(b.slUsd)} per trade` : 'Targets follow volatility (ATR)'); });
    $$('input[data-usd]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.usd, min = k.startsWith('basket') ? 0 : .5; let val = Math.max(min, Math.round((+inp.value || 0) * 100) / 100);
      inp.value = val; b[k] = val; save(); $('#t_hint').innerHTML = targetHint(); paint($('#radar'), radarHtml(), 'radar'); toast(k.startsWith('basket') ? (val ? `Basket ${k === 'basketTp' ? 'take-profit' : 'stop-loss'} $${fmt(val)}` : 'Basket target off') : `${k === 'tpUsd' ? 'Take-profit' : 'Stop-loss'} set to $${fmt(val)} per trade`);
    });
    $('#clearlog').onclick = () => { S.log = []; store.set('log', []); $('#botlog').innerHTML = logHtml(); };
  }
  /* Getting-started guide: steps tick themselves off from the app's state. */
  function guideSteps() {
    const live = isLive(), n = S.history.length, t = testedState();
    return [
      { t: 'Watch the bot on Paper', d: 'Turn on the Sentiment Bot in Auto-Trade while on Paper and see how it opens and closes trades. Paper prices are simulated, so its profit or loss here proves nothing either way.', done: !!S.bot.everRan, go: 'bot' },
      { t: 'Keep the tested settings', d: 'Use the Conservative or Balanced preset. Those are the settings that held up when the bot was replayed over 16 months of real prices. Custom settings are untested.', done: !!t.match, go: 'bot' },
      { t: 'Connect an MT5 demo account', d: 'Open a free demo account with your broker (in XM: “Open demo account”), then connect it in Profile → Trading account. A demo uses real prices with pretend money.', done: live, go: 'profile' },
      { t: 'Let it run for 2–4 weeks', d: `Judge the bot on at least 30 closed trades, not one or two. Portfolio → “Where P/L comes from” shows what is making or losing money.${live ? ` So far: ${n} closed.` : ''}`, done: live && n >= 30, go: 'portfolio' },
      { t: 'Go live small, or not at all', d: 'Only if the demo results are acceptable: use a real account with 0.5% risk per trade and the daily loss limit on. Only trade money you can afford to lose.', done: false },
    ];
  }
  function guideCardHtml() {
    const st = guideSteps(), done = st.filter(x => x.done).length, next = st.find(x => !x.done);
    return `<div class="row between"><div><div class="sub">🌱 Getting started · ${done} of ${st.length}</div><div class="title">${next ? 'Next: ' + next.t : 'All steps done'}</div></div><span class="chev">›</span></div>
      <div class="bar" style="margin-top:10px"><i class="upbg" style="width:${Math.max(4, done / st.length * 100)}%"></i></div>`;
  }
  function openGuide() {
    const st = guideSteps();
    sheet(`<h2>Getting started</h2><p class="sub" style="margin:-4px 0 12px">A safe path from first look to real money. Steps tick off by themselves.</p>
      ${st.map((x, i) => `<div class="gstep ${x.done ? 'done' : ''}"><span class="gnum">${x.done ? '✓' : i + 1}</span><div class="grow"><div class="title">${x.t}</div><div class="sub">${x.d}</div>
        ${x.go && !x.done ? `<button class="sub linkbtn" data-gogo="${x.go}">Go there ›</button>` : ''}</div></div>`).join('')}
      <div class="notice" style="margin-top:12px">No bot or setting guarantees profit. The tested presets only roughly broke even to slightly positive in testing, mostly from gold.</div>
      <button class="btn ghost" data-sheetclose style="margin-top:12px">Close</button>`,
      bg => { $$('[data-gogo]', bg).forEach(x => x.onclick = () => { closeSheet(bg); S.slideTo ? S.slideTo(x.dataset.gogo) : goTab(x.dataset.gogo); }); $('[data-sheetclose]', bg).onclick = () => closeSheet(bg); }, 'guide');
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-guide]')) openGuide(); });
  function testedHtml() {
    const t = testedState(), lvl = LEVELS[level()];
    const head = `<div class="row between"><span class="sub">${lvl.icon} ${lvl.label} mode</span><button class="sub linkbtn" data-guide>Getting started guide ›</button></div>`;
    if (t.match) { const p = RISK_PRESETS[t.match];
      return `${head}<div class="row" style="gap:10px;margin-top:8px"><span class="okdot">✓</span><div><div class="title">Tested ${p.label} settings</div>
        <div class="sub">${p.timeframe} · ±${p.threshold} · ${p.minConfidence}% · SL ${p.slAtr} / TP ${p.tpAtr} ATR · trend filter · profit protection</div></div></div>`; }
    return `${head}<div class="row" style="gap:10px;margin-top:8px"><span class="okdot warn">!</span><div class="grow"><div class="title">Custom settings · not tested</div>
      <div class="sub">Differs from tested ${RISK_PRESETS[t.nearest].label}: ${t.diffs.map(d => DIFF_LABEL[d]).join(', ')}</div></div></div>
      <button class="btn small" id="resettested" style="margin-top:10px;width:100%">Reset to tested ${RISK_PRESETS[t.nearest].label}</button>`;
  }
  function bindTested(v) {
    const r = $('#resettested'); if (r) r.onclick = async () => {
      const k = testedState().nearest;
      if (!(await ask({ title: `Reset to tested ${RISK_PRESETS[k].label}?`, message: 'Timeframe, entry rules, stops, trend filter and flip exit go back to the backtested values. Strategy becomes Auto and targets follow volatility (ATR). Your symbols stay as they are.', ok: 'Reset', ic: 'bot' }))) return;
      applyTested(k); save(); S.candleCache = {}; resetSeries(); analyseAll(); viewBot(v); toast(`Tested ${RISK_PRESETS[k].label} settings applied`); log(`Reset to tested ${RISK_PRESETS[k].label} settings`);
    };
  }
  function refreshTested() { const t = S.tab === 'bot' && document.getElementById('tested'); if (t) { paint(t, testedHtml(), 'tested'); bindTested($('#view')); } }
  const presetHint = () => level() === 'beginner' ? 'Conservative trades on 1-hour charts with half the risk. Balanced trades on 15-minute charts. Both were tested on 16 months of real prices.'
    : 'All three presets were tested on 16 months of real prices. Tapping one resets strategy to Auto and targets to ATR.';
  const slider = (k, l, min, max, step, pre = '', suf = '') => `<div class="field"><div class="row between"><label style="margin:0 0 4px 4px">${l}</label><b class="mono" id="v_${k}">${pre}${S.bot[k]}${suf}</b></div>
    <input type="range" data-k="${k}" data-pre="${pre}" data-suf="${suf}" min="${min}" max="${max}" step="${step}" value="${S.bot[k]}"></div>`;
  const tfHint = () => ({
    '5m': '<span class="down">⚠ High cost.</span> 5-minute trades are small, so the spread eats most of the profit. In testing every 5m setup lost money. 15m or 1h is recommended.',
    '15m': 'Recommended. Trades last a few hours on average.',
    '1h': 'Fewer, longer trades with the lowest spread cost. Good for a calm, conservative bot.',
    '4h': 'Very few trades, held for days. Overnight swap fees apply.',
  })[S.bot.timeframe] || '';
  const targetHint = () => `Each trade closes at about <b class="up">+$${fmt(S.bot.tpUsd)}</b> or <b class="down">−$${fmt(S.bot.slUsd)}</b>. The bot picks the lot size so the target sits about ${S.bot.tpAtr}× ATR away (set under Strategy), within Max lot. Spread and commission are not included.`;
  function radarHtml() {
    return watch().map(sym => { const [a, d] = botDecision(sym);
      return `<div class="list-item" data-key="r${sym}"><div class="avatar">${sym.slice(0, 3)}</div><div class="grow"><div class="title">${sym} <span class="sub">${a ? Engine.REGIME_LABEL[a.regime] : '…'}</span></div>
        <div class="sub">${Engine.STRATEGIES[d.strategy].icon} ${Engine.STRATEGIES[d.strategy].label} · ${esc(d.why)}${S.bot.targetMode === 'usd' ? ` · <span class="up">+$${fmt(S.bot.tpUsd)}</span>/<span class="down">−$${fmt(S.bot.slUsd)}</span>` : d.riskMult !== 1 && d.action !== 'HOLD' ? ` · size ×${d.riskMult}` : ''}</div></div>
        <span class="chip ${d.action === 'BUY' ? 'up' : d.action === 'SELL' ? 'down' : 'neutral'}">${d.action}</span></div>`; }).join('') || '<div class="empty">Pick symbols below</div>';
  }
  function botStatusHtml() {
    const b = S.bot, botPos = S.positions.filter(p => isBot(p)).length;
    return `<div class="row between"><div class="row"><div class="avatar" style="background:var(--grad);color:#fff">${icon('bot')}</div><div><div class="title">Sentiment Bot</div>
      <div class="sub"><span class="dot ${b.enabled ? 'live' : ''}"></span> ${b.enabled ? 'Running' : b.pausedReason || 'Paused'} · ${isLive() ? 'Live MT5' : 'Paper'}</div></div></div>
      <label class="toggle"><input type="checkbox" id="bottoggle" ${b.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="grid3" style="margin-top:12px"><div class="stat"><div class="lbl">Watching</div><div class="val">${b.symbols.length}</div></div>
      <div class="stat"><div class="lbl">Bot trades</div><div class="val">${botPos}/${b.maxPositions}</div></div><div class="stat"><div class="lbl">Today</div><div class="val mono ${cls(todayPnl())}">${signed(todayPnl())}</div></div></div>
      ${S.positions.length ? `<button class="btn ghost" data-closeall style="margin-top:12px">${icon('x')}Close all positions (${S.positions.length})</button>` : ''}`;
  }
  async function toggleBot(on) {
    if (on && !S.bot.symbols.length) { toast('Pick at least one symbol'); $('#bottoggle').checked = false; return; }
    if (on && isLive()) {
      const ok = await ask({ title: 'Enable live auto-trading?', message: 'The bot will open and close <b>real positions</b> on your MT5 account using your strategy and risk settings. You are responsible for any losses.', ok: 'Enable bot', tone: 'danger', ic: 'bot' });
      if (!ok || (S.profile.biometric && !(await Security.verify('Confirm to enable live auto-trading')))) { $('#bottoggle').checked = false; return; }
    }
    S.bot.enabled = on; S.bot.pausedReason = ''; if (on) S.bot.everRan = true; save(); log(on ? `Bot started (${RISK_PRESETS[S.bot.profile]?.label || 'Custom'} profile)` : 'Bot stopped', on ? 'up' : '');
    const st = $('#botstat'); if (st) { paint(st, botStatusHtml(), 'bot'); const t = $('#bottoggle'); t.checked = S.bot.enabled; t.onchange = e => toggleBot(e.target.checked); bindPositions(st); }
    scheduleBot(true);
  }
  const logRow = l => `<div><time>${time(l.t)}</time><span class="${l.kind}">${esc(maskText(l.msg))}</span></div>`;
  const logHtml = () => S.log.map(logRow).join('') || '<div class="empty">No activity yet</div>';

  /* ---------- Portfolio ---------- */
  function viewPortfolio(v) {
    const a = S.account || {}, h = S.history;
    const wins = h.filter(d => d.profit > 0), realized = h.reduce((s, d) => s + d.profit, 0);
    const exp = {}; S.positions.forEach(p => exp[p.symbol] = (exp[p.symbol] || 0) + Math.abs(p.volume));
    paint(v, `<div class="screen">${topbar('Portfolio')}
      <div class="card"><div class="row between"><div><div class="sub">Realised P/L (${isLive() ? '30 days' : 'all time'})</div><div class="big mono ${cls(realized)}" style="font-size:28px">${signed(realized)}</div></div>
        <div class="right"><div class="sub">Win rate</div><div class="title" style="font-size:20px">${h.length ? fmt(wins.length / h.length * 100, 0) : 0}%</div></div></div>
        ${h.length ? '<div class="chart-box" style="height:120px;margin-top:8px"><canvas id="eq" height="120"></canvas></div>' : '<div class="sub" style="margin:10px 0">Equity curve appears after your first closed trade.</div>'}
        <div class="grid3"><div class="stat"><div class="lbl">Trades</div><div class="val">${h.length}</div></div><div class="stat"><div class="lbl">Avg win</div><div class="val mono up">${money(wins.length ? wins.reduce((s, d) => s + d.profit, 0) / wins.length : 0)}</div></div>
        <div class="stat"><div class="lbl">Avg loss</div><div class="val mono down">${money(h.length - wins.length ? h.filter(d => d.profit <= 0).reduce((s, d) => s + d.profit, 0) / (h.length - wins.length) : 0)}</div></div></div></div>
      ${h.length ? `<h3>Where P/L comes from</h3><div class="card">${exitBreakdown(h)}</div>` : ''}
      <h3>Bot performance</h3><div class="card" id="perf" data-key="perf">${perfHtml()}</div>
      <h3>Allocation</h3><div class="card">${Object.keys(exp).length ? `<div class="row">${donut(exp)}<div class="donut-legend grow">${Object.entries(exp).map(([s, vol], k) => `<div><i style="background:${pal(k)}"></i>${s}<span class="grow"></span><b class="mono">${fmt(vol)} lot</b></div>`).join('')}</div></div>` : '<div class="empty">No open exposure</div>'}</div>
      ${posHeader('Open positions · ' + S.positions.length)}<div class="card">${positionsHtml(S.positions)}</div>
      <h3>Closed trades</h3><div class="card">${h.slice(0, 30).map(d => `<div class="list-item" data-key="d${d.id}-${d.time}"><div class="avatar ${d.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${d.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
        <div class="grow"><div class="title">${d.symbol} <span class="sub">${fmt(d.volume)} lot</span></div><div class="sub">${new Date(d.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${closeWhy(d)}</div></div>
        <div class="mono title ${cls(d.profit)}">${signed(d.profit)}</div></div>`).join('') || '<div class="empty">No closed trades yet</div>'}</div>
    </div>`, 'portfolio');
    bindTop(); bindPositions(v);
    $$('#perfby button', v).forEach(b => b.onclick = () => { S.perfBy = b.dataset.b; const c = $('#perf', v); c.innerHTML = perfHtml(); viewPortfolio(v); });
    const oj = $('#openjournal', v); if (oj) oj.onclick = openJournal;
    const pts = []; let run = (a.balance ?? 0) - realized; pts.push(run); h.slice().reverse().forEach(d => pts.push(run += d.profit)); pts.push(a.equity ?? run);
    if (!S.privacy) drawLine($('#eq'), pts);
  }
  /* P/L grouped by how trades closed: shows at a glance which exit is costing money. */
  function exitBreakdown(h) {
    const g = {}; h.forEach(d => { const k = closeWhy(d); (g[k] ||= { n: 0, w: 0, p: 0 }); g[k].n++; g[k].p += d.profit; if (d.profit > 0) g[k].w++; });
    const rows = Object.entries(g).sort((x, y) => x[1].p - y[1].p), max = Math.max(...rows.map(([, v]) => Math.abs(v.p)), 1e-9);
    return rows.map(([k, v]) => `<div class="exitrow" data-key="x${esc(k)}"><div class="row between"><span>${esc(k)} <span class="sub">${v.n} trade${v.n === 1 ? '' : 's'} · ${Math.round(v.w / v.n * 100)}% won</span></span><b class="mono ${cls(v.p)}">${signed(v.p)}</b></div>
      <div class="bar"><i class="${v.p >= 0 ? 'upbg' : 'downbg'}" style="width:${Math.max(3, Math.abs(v.p) / max * 100).toFixed(0)}%"></i></div></div>`).join('');
  }
  /* Who/what closed a trade: paper keeps an explicit reason; MT5 deals carry it in the close comment. */
  function closeWhy(d) {
    let r = d.reason || '';
    const c = d.comment || '';
    if (!r) r = /\[sl/i.test(c) ? 'SL' : /\[tp/i.test(c) ? 'TP' : /\[so/i.test(c) ? 'Stop out' : /^TBX /.test(c) ? c.slice(4) : c ? 'Closed in MT5' : '';
    if (r === 'SL' && d.profit > 0) return '🔒 Protected stop (profit locked)';
    if (r === 'SL' && d.profit > -1) return '🔒 Break-even stop';
    if (r === 'SL') return '🛑 Stop-loss hit';
    if (r === 'TP') return '🎯 Take-profit hit';
    if (/^Bot|^Basket/.test(r)) return '🤖 ' + r;
    if (r === 'Close all') return '⛔ Close all';
    if (r === 'Manual') return '✋ Closed by you';
    return r || '—';
  }
  const pal = k => ['var(--accent)', 'var(--up)', 'var(--warn)', 'var(--accent2)', 'var(--down)', '#5ac8fa', '#ff9f0a'][k % 7];
  function donut(exp) {
    const tot = Object.values(exp).reduce((a, b) => a + b, 0); let acc = 0; const C = 2 * Math.PI * 40;
    return `<svg viewBox="0 0 100 100" style="width:120px;flex:none;transform:rotate(-90deg)">${Object.values(exp).map((v, k) => { const len = v / tot * C; const s = `<circle cx="50" cy="50" r="40" fill="none" stroke="${pal(k)}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"/>`; acc += len; return s; }).join('')}</svg>`;
  }
  function positionsHtml(list) {
    if (!list.length) return '<div class="empty">No open positions</div>';
    return list.map(p => `<div class="list-item tappable" data-key="p${p.id}" data-trade="${p.id}"><div class="avatar ${p.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
      <div class="grow"><div class="title">${p.symbol} <span class="sub">${fmt(p.volume)} lot${isBot(p) ? ' · 🤖' : ''}</span> <span class="chev">›</span></div><div class="sub mono">${px(p.symbol, p.openPrice)} → ${px(p.symbol, p.currentPrice)}</div></div>
      <div class="right"><div class="mono title ${cls(p.profit)}">${signed(p.profit)}</div><button class="sub" data-close="${p.id}" style="color:var(--accent);font-weight:700">Close</button></div></div>`).join('');
  }
  const posHeader = t => `<div class="section-head"><h3>${t}</h3>${S.positions.length ? `<button class="closeall-pill" data-closeall>${icon('x')}Close all</button>` : ''}</div>`;
  function bindPositions(root) {
    $$('[data-closeall]', root).forEach(b => b.onclick = openCloseAll);
    $$('[data-close]', root).forEach(b => b.onclick = async () => {
      if (Date.now() - (S._slideAt || 0) < 450) return;          // finger was swiping the trade card, not tapping Close
      const p = S.positions.find(x => x.id === b.dataset.close); if (!p) return;
      const mode = S.prefs.confirmClose, losing = p.profit < 0;
      if (mode === 'always' || (mode === 'loss' && losing)) {
        const side = p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL';
        if (!(await ask({ title: losing ? 'Close at a loss?' : 'Close this trade?',
          message: `${side} ${fmt(p.volume)} lot <b>${p.symbol}</b> · ${isBot(p) ? '🤖 bot trade' : '✋ manual trade'}<br>Current P/L <b class="${cls(p.profit)}">${signed(p.profit)}</b>${losing ? '<br>Closing now makes this loss final.' : ''}${isLive() ? '<br>This is a <b>live</b> position on your MT5 account.' : ''}`,
          ok: losing ? 'Close at a loss' : 'Close trade', tone: 'danger', ic: 'x' }))) return;
      }
      try { await S.broker.closePosition(b.dataset.close, 'Manual'); toast('Position closed'); log(`You closed ${p.symbol} #${b.dataset.close}: ${signed(p.profit)}`, cls(p.profit)); poll(); } catch (e) { toast('Close failed: ' + e.message); }
    });
  }

  /* ---------- Close all ---------- */
  const CLOSE_FILTERS = {
    all: ['All positions', p => true],
    bot: ['Bot trades only', p => isBot(p)],
    profit: ['Profitable only', p => p.profit > 0],
    loss: ['Losing only', p => p.profit <= 0],
  };
  function closeRowsHtml() {
    return Object.entries(CLOSE_FILTERS).map(([k, [label, f]]) => { const list = S.positions.filter(f), pl = list.reduce((x, p) => x + p.profit, 0);
      return `<button class="list-item close-opt" data-f="${k}" ${list.length ? '' : 'disabled'} style="width:100%;text-align:left;${list.length ? '' : 'opacity:.45'}"><div class="avatar">${list.length}</div>
        <div class="grow"><div class="title">${label}</div><div class="sub">${list.length} position${list.length === 1 ? '' : 's'}</div></div><div class="mono title ${cls(pl)}">${signed(pl)}</div></button>`; }).join('');
  }
  function openCloseAll() {
    if (!S.positions.length) return toast('No open positions');
    sheet(`<h2>Close positions</h2><p class="sub">Market orders close at the current price. Floating P/L shown per group.</p>
      <div class="card" style="padding:4px 14px" id="closelist" data-view="close">${closeRowsHtml()}</div>
      <div class="card row between"><div><div class="title">Also stop the bot</div><div class="sub">Prevents new trades straight after closing</div></div><label class="toggle"><input type="checkbox" id="stopbot" ${S.bot.enabled ? 'checked' : ''}><span></span></label></div>
      ${isLive() ? '<div class="notice">This closes <b>live</b> positions on your MT5 account.</div>' : ''}`, el => {
      $('#closelist', el).onclick = async e => { const b = e.target.closest('.close-opt'); if (!b || b.disabled) return;
        const [label, f] = CLOSE_FILTERS[b.dataset.f], n = S.positions.filter(f).length;
        if (!n) return;
        const grpPl = S.positions.filter(f).reduce((x, p) => x + p.profit, 0);
        if (!(await ask({ title: `Close ${n} position${n === 1 ? '' : 's'}?`, message: `${label} · floating P/L <b class="${cls(grpPl)}">${signed(grpPl)}</b>${isLive() ? '<br>These are <b>live</b> positions on your MT5 account.' : ''}`, ok: n === 1 ? 'Close position' : `Close ${n}`, tone: 'danger', ic: 'x' }))) return;
        const stop = $('#stopbot', el).checked; closeSheet(el);
        await closeAll(b.dataset.f, stop);
      };
    }, 'closesheet');
  }
  async function closeAll(filter = 'all', stopBot = false, reason = 'Close all') {
    if (stopBot && S.bot.enabled) { S.bot.enabled = false; S.bot.pausedReason = 'Stopped by Close all'; save(); scheduleBot(); log('Bot stopped (Close all)'); }
    await poll();
    const [label, f] = CLOSE_FILTERS[filter], list = S.positions.filter(f);
    toast(`Closing ${list.length} position${list.length === 1 ? '' : 's'}…`);
    let ok = 0, pl = 0; const fails = [];
    for (const p of list) { // sequential: friendlier to broker/API rate limits
      try { await S.broker.closePosition(p.id, reason); ok++; pl += p.profit; } catch (e) { fails.push(`${p.symbol}: ${e.message}`); }
    }
    log(`Close all (${label.toLowerCase()}): ${ok}/${list.length} closed, ${signed(pl)}`, cls(pl));
    if (fails.length) log('Not closed: ' + fails.join('; '), 'down');
    toast(fails.length ? `${ok} closed, ${fails.length} failed. See the log.` : `Closed ${ok} position${ok === 1 ? '' : 's'} · ${signed(pl)}`);
    S._histT = 0; await poll();
  }

  /* ---------- Profile ---------- */
  function viewProfile(v) {
    const p = S.profile;
    v.innerHTML = `<div class="screen">${topbar('Profile')}
      <div class="card row"><div class="avatar" style="background:${p.color};color:#fff;width:58px;height:58px;border-radius:20px;font-size:22px">${esc(p.name[0]).toUpperCase()}</div>
        <div class="grow"><div class="title" style="font-size:18px">${esc(p.name)}</div><div class="sub"><span id="pidsub">${esc(profileSub())}</span></div>
        <span class="chip" style="margin-top:6px">${LEVELS[level()].icon} ${LEVELS[level()].label} · ${RISK_PRESETS[p.riskProfile]?.label || 'Custom'} investor</span></div></div>
      <h3>Trading experience</h3><div class="card">
        <div class="seg" id="plevel">${Object.entries(LEVELS).map(([k, l]) => `<button data-l="${k}" class="${level() === k ? 'on' : ''}">${l.label}</button>`).join('')}</div>
        <p class="hint" id="plevelhint">${LEVELS[level()].desc}</p>
        <div class="row between list-item" style="margin-top:6px"><div><div class="title">Getting started guide</div><div class="sub">Paper → tested settings → demo account → live</div></div><button class="btn small ghost" data-guide>Open</button></div>
        <div class="row between list-item"><div><div class="title">Show guide on Dashboard</div><div class="sub">Beginner and Moderate levels, until the first steps are done</div></div><label class="toggle"><input type="checkbox" id="pguide" ${S.prefs.guideHidden ? '' : 'checked'}><span></span></label></div>
      </div>
      <h3>Trading account</h3><div class="card"><div class="row between"><div class="row"><div class="avatar">${S.conn.mode === 'bridge' ? 'VPS' : isLive() ? 'MT5' : 'SIM'}</div>
        <div><div class="title"><span id="pacct">${esc(acctTitle())}</span></div><div class="sub">${isLive() ? esc(S.conn.server || 'MT5') + ' · ' + (S.conn.mode === 'bridge' ? 'Own VPS' : 'MetaApi') + ' · ' + S.status : 'Simulated market · $10,000 start'}</div></div></div>
        <button class="btn small" id="conn">${isLive() ? 'Manage' : 'Connect MT5'}</button></div></div>
      <h3>Appearance</h3><div class="card">
        <div class="seg" id="tmode3"><button data-a="system" class="${S.theme === 'system' ? 'on' : ''}">System</button><button data-a="light" class="${S.theme === 'light' ? 'on' : ''}">Light</button><button data-a="dark" class="${S.theme !== 'system' && S.theme !== 'light' ? 'on' : ''}">Dark</button></div>
        <div class="row between list-item" style="margin:10px 0 4px"><div><div class="title">Hide status & navigation bars</div><div class="sub">The app already fills the screen behind the bars. Turn this on to hide them too; swipe in from an edge to see them briefly.</div></div><label class="toggle"><input type="checkbox" id="pfull" ${S.prefs.hideBars ? 'checked' : ''}><span></span></label></div>
        <p class="hint" id="thint">${S.theme === 'system' ? `Following your phone: currently <b>${systemIsDark() ? 'dark' : 'light'}</b>.` : S.theme === 'light' ? 'Always light.' : 'Always dark.'}</p>
        <div class="field" style="margin:16px 0 0"><div class="row between"><label style="margin:0 0 0 4px">Dashboard card opacity</label>
            <div class="stepper"><button id="hminus" aria-label="Less opaque">−</button><b class="mono" id="heroav">${Math.round(S.heroAlpha * 100)}%</b><button id="hplus" aria-label="More opaque">+</button></div></div>
          <div class="presets" id="hpresets">${[25, 50, 65, 80, 100].map(v => `<button data-v="${v}" class="${Math.round(S.heroAlpha * 100) === v ? 'on' : ''}">${v}%</button>`).join('')}</div>
          <div class="hero-preview card hero ${S.heroAlpha < .7 ? 'soft' : ''}" id="heropv"><div class="row between"><span class="muted">Equity preview</span><span class="chip">PAPER</span></div><div class="mono" id="heropvv" style="font-size:22px;font-weight:800;margin-top:4px">${money(10000)}</div></div></div>
      </div>
      <h3>Edit profile</h3><div class="card">
        <div class="field"><label>Display name</label><input class="input" id="pname" value="${esc(p.name)}" maxlength="24"></div>
        <div class="field"><label>Email</label><input class="input" id="pemail" value="${esc(p.email)}"></div>
        <div class="field"><label>Investor risk profile</label><div class="seg" id="prisk">${Object.entries(RISK_PRESETS).map(([k, r]) => `<button data-k="${k}" class="${p.riskProfile === k ? 'on' : ''}">${r.label}</button>`).join('')}</div></div>
        <button class="btn" id="psave">Save profile</button></div>
      <h3>Privacy</h3><div class="card">
        <div class="row between list-item"><div><div class="title">Hide amounts when the app opens</div><div class="sub">Start with balances, P/L, email and MT5 login hidden. Tap the 👁 eye at the top of any screen to show or hide them.</div></div><label class="toggle"><input type="checkbox" id="phide" ${S.prefs.hideByDefault ? 'checked' : ''}><span></span></label></div>
        <div class="row between list-item"><div><div class="title">Hidden right now</div><div class="sub">Same as the eye button</div></div><label class="toggle"><input type="checkbox" id="pnow" ${S.privacy ? 'checked' : ''}><span></span></label></div>
      </div>
      <h3>Trading safety</h3><div class="card">
        <div class="title">Confirm before closing a trade</div><div class="sub" style="margin-bottom:10px">Ask before a single trade is closed from its Close button.</div>
        <div class="seg" id="cconf">${[['always', 'All trades'], ['loss', 'Losing only'], ['off', 'Off']].map(([k, l]) => `<button data-c="${k}" class="${S.prefs.confirmClose === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="hint">Close all always asks first.</p></div>
      <h3>Security</h3><div class="card">
        <div class="row between list-item"><div><div class="title">Fingerprint unlock</div><div class="sub">Require biometrics to open the app</div></div><label class="toggle"><input type="checkbox" id="pbio" ${p.biometric ? 'checked' : ''}><span></span></label></div>
        <div class="row between list-item"><div><div class="title">Change PIN</div><div class="sub">6-digit fallback PIN</div></div><button class="btn small ghost" id="ppin">Change</button></div>
        <div class="row between list-item"><div><div class="title">Lock now</div></div><button class="btn small ghost" id="plock">Lock</button></div></div>
      <h3>News</h3><div class="card">
        <div class="row between list-item"><div><div class="title">Economic calendar</div><div class="sub">${Brokers.Calendar.data.events.length ? `${Brokers.Calendar.data.events.length} events this week · updated ${relTime(Brokers.Calendar.data.t)}` : Brokers.Calendar.error ? 'Unavailable: ' + esc(Brokers.Calendar.error) : 'Loading…'} · no key needed</div></div><button class="btn small ghost" data-news>Open</button></div>
        <div class="field" style="margin-top:10px"><label>Headline sentiment · Alpha Vantage key (optional)</label><input class="input mono" id="nkey" value="${esc(S.newsKey)}" placeholder="Free key from alphavantage.co"></div>
        <div class="hint">Adds a news factor (20% weight) to each symbol's score: currency tone for forex, USD tone (inverted) for gold and silver, market tone for US indices, coin tone for crypto. The free key allows 25 requests a day, so headlines refresh every 90 minutes (16 a day).${S.newsKey ? ` Status: ${Brokers.News.st.status ? esc(Brokers.News.st.status) : Brokers.News.st.ok ? `${Brokers.News.st.articles.length} articles, updated ${relTime(Brokers.News.st.ok)}` : 'waiting for first update'}.` : ''}</div>
        <button class="btn ghost" id="nsave" style="margin-top:10px">Save key</button></div>
      <h3>Data</h3><div class="card">
        <div class="row between list-item" style="margin-bottom:10px"><div><div class="title">Trade journal</div><div class="sub">${J.list.length} recent · ${arcCount()} archived · ${journalSizeKb()} KB. Keeps the latest ${J_ACTIVE} closed trades at hand and archives older ones automatically (up to ${J_ARCHIVE.toLocaleString()}; beyond that only totals are kept).</div></div><button class="btn small ghost" id="jclear">Clear</button></div>
        ${S.conn.mode === 'demo' ? '<button class="btn ghost" id="reset" style="margin-bottom:10px">Reset paper account</button>' : ''}<button class="btn danger" id="wipe">Sign out & erase app data</button></div>
      <h3>About</h3><div class="card about" id="about">${aboutHtml()}</div>
      <p class="hint" style="text-align:center;margin-top:12px">Not financial advice. Trading leveraged products carries a high risk of loss.</p>
    </div>`;
    bindTop();
    $('#conn').onclick = openConnect;
    const themeUi = () => viewProfile(v);
    $$('#tmode3 button').forEach(b => b.onclick = () => { const a = b.dataset.a; setTheme(a === 'dark' ? 'midnight' : a); themeUi(); });
    // Tap-only controls (no slider), so scrolling through Profile can never change the value by accident
    const setHero = pct => {
      pct = Math.max(15, Math.min(100, Math.round(pct / 5) * 5)); S.heroAlpha = pct / 100; save(); applyHero();
      $('#heroav').textContent = pct + '%'; $('#hminus').disabled = pct <= 15; $('#hplus').disabled = pct >= 100;
      $$('#hpresets button').forEach(b => b.classList.toggle('on', +b.dataset.v === pct));
    };
    if ($('#hminus')) {
      $('#hminus').onclick = () => setHero(S.heroAlpha * 100 - 5);
      $('#hplus').onclick = () => setHero(S.heroAlpha * 100 + 5);
      $$('#hpresets button').forEach(b => b.onclick = () => setHero(+b.dataset.v));
      setHero(S.heroAlpha * 100);
    }
    $$('#plevel button').forEach(x => x.onclick = async () => {
      const lv = x.dataset.l; if (lv === level()) return;
      if (lv === 'beginner' && !testedState().match && !(await ask({ title: 'Switch to Beginner?', message: 'Beginner mode uses only the tested presets, so your custom bot settings will be reset to the tested Conservative or Balanced values. Your symbols stay.', ok: 'Switch', ic: 'bot' }))) return;
      setLevel(lv); toast(`${LEVELS[lv].label} mode`); log(`Trading experience set to ${LEVELS[lv].label}`); viewProfile(v);
    });
    $('#pfull').onchange = e => { S.prefs.hideBars = e.target.checked; save(); applyFullscreen(); };
    $('#pguide').onchange = e => { S.prefs.guideHidden = !e.target.checked; save(); };
    let risk = p.riskProfile;
    $$('#prisk button').forEach(b => b.onclick = () => { risk = b.dataset.k; $$('#prisk button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#psave').onclick = () => { const n = $('#pname').value.trim(); if (!n) return toast('Name required'); Object.assign(p, { name: n, email: $('#pemail').value.trim(), riskProfile: risk }); applyTested(risk); save(); toast('Profile saved'); viewProfile(v); };
    $('#pbio').onchange = async e => { if (e.target.checked && !(await Security.verify('Enable fingerprint unlock'))) { e.target.checked = false; return; } p.biometric = e.target.checked; save(); toast(p.biometric ? 'Fingerprint enabled' : 'Fingerprint disabled'); };
    $('#ppin').onclick = changePin;
    $('#whatsnew').onclick = () => openChangelog();
    loadAppInfo().then(() => { const ab = $('#about'); if (ab) { ab.innerHTML = aboutHtml(); $('#whatsnew').onclick = () => openChangelog(); } });
    $('#phide').onchange = e => { S.prefs.hideByDefault = e.target.checked; save(); toast(e.target.checked ? 'Amounts will be hidden each time the app opens' : 'Amounts shown when the app opens'); };
    $('#pnow').onchange = e => setPrivacy(e.target.checked, true);
    $$('#cconf button').forEach(b => b.onclick = () => { S.prefs.confirmClose = b.dataset.c; save(); $$('#cconf button').forEach(x => x.classList.toggle('on', x === b)); toast(b.dataset.c === 'off' ? 'Close confirmation off' : b.dataset.c === 'loss' ? 'Confirm closing losing trades' : 'Confirm closing every trade'); });
    $('#plock').onclick = () => { S.unlocked = false; render(); };
    $('#nsave').onclick = async () => { S.newsKey = $('#nkey').value.trim(); store.set('newsKey', S.newsKey); toast(S.newsKey ? 'News sentiment enabled' : 'News sentiment off'); if (S.newsKey) { await Brokers.News.refresh(S.newsKey, true); viewProfile(v); analyseAll(); } };
    $('#jclear').onclick = async () => { if (await ask({ title: 'Clear trade journal?', message: `Removes the journal and its stats for ${acctKey() === 'paper' ? 'Paper' : 'this MT5 account'} and resets guardrails. Trades and history at your broker are not affected.`, ok: 'Clear', tone: 'danger', ic: 'wallet' })) { journalClear(acctKey()); toast('Journal cleared'); viewProfile(v); } };
    const r = $('#reset'); if (r) r.onclick = async () => { if (await ask({ title: 'Reset paper account?', message: 'Balance goes back to $10,000 and paper positions and history are cleared.', ok: 'Reset', tone: 'danger', ic: 'wallet' })) { S.broker.reset(); journalClear('paper'); log('Paper account reset'); poll(); toast('Paper account reset'); } };
    $('#wipe').onclick = async () => { if (!(await ask({ title: 'Sign out & erase data?', message: 'Your profile, PIN, settings and stored MetaApi token are removed from this device. Your MT5 account is not affected.', ok: 'Erase', tone: 'danger', ic: 'user' }))) return; await Security.deleteSecret('metaapi'); Object.keys(localStorage).filter(k => k.startsWith('tb')).forEach(k => localStorage.removeItem(k)); location.reload(); };
  }
  function changePin() {
    sheet(`<h2>Change PIN</h2><div class="field" style="margin-top:12px"><label>Current PIN</label><input class="input mono" id="c0" type="password" inputmode="numeric" maxlength="6"></div>
      <div class="field"><label>New PIN</label><input class="input mono" id="c1" type="password" inputmode="numeric" maxlength="6"></div><button class="btn" id="cgo">Update PIN</button>`, el => {
      $('#cgo', el).onclick = async () => {
        if (await Security.hashPin($('#c0', el).value) !== S.profile.pinHash) return toast('Current PIN is wrong');
        if (!/^\d{6}$/.test($('#c1', el).value)) return toast('PIN must be 6 digits');
        S.profile.pinHash = await Security.hashPin($('#c1', el).value); save(); el.remove(); toast('PIN updated');
      };
    });
  }
  /* Themed in-app dialog (replaces the native Android confirm box). Resolves true/false. */
  function ask({ title, message = '', ok = 'Confirm', cancel = 'Cancel', tone = 'primary', ic = 'shield' }) {
    return new Promise(resolve => {
      const d = document.createElement('div'); d.className = 'dlg-bg';
      d.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true"><div class="dlg-ic ${tone}">${icon(ic)}</div>
        <h2>${esc(title)}</h2>${message ? `<p>${message}</p>` : ''}
        <div class="dlg-actions"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${tone === 'danger' ? 'danger' : tone === 'up' ? 'buy' : ''}" data-r="1">${esc(ok)}</button></div></div>`;
      const done = v => { if (d._done) return; d._done = true; d.classList.remove('open'); setTimeout(() => d.remove(), 200); resolve(v); };
      d._cancel = () => done(false);
      d.onclick = e => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); else if (e.target === d) done(false); };
      document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('open')));
    });
  }

  function sheet(html, bind, id) { const bg = document.createElement('div'); bg.className = 'sheet-bg'; if (id) bg.id = id; bg.innerHTML = `<div class="sheet"><div class="grip"></div>${html}</div>`; document.body.appendChild(bg); attachSheet(bg); bind && bind(bg); return bg; }

  /* Bottom-sheet behaviour: slide up on open; swipe down (from the top of its content), tap outside or Back to close. */
  function attachSheet(bg) {
    const sh = $('.sheet', bg);
    requestAnimationFrame(() => requestAnimationFrame(() => bg.classList.add('open')));
    bg.addEventListener('click', e => { if (e.target === bg) closeSheet(bg); });
    let y0 = null, dy = 0, t0 = 0, dragging = false;
    sh.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      if (sh.scrollTop > 0 && !e.target.closest('.grip')) return; // let the content scroll first
      y0 = e.touches[0].clientY; t0 = performance.now(); dy = 0; dragging = false;
    }, { passive: true });
    sh.addEventListener('touchmove', e => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (!dragging) { if (dy > 8) { dragging = true; sh.classList.add('dragging'); } else if (dy < -8) { y0 = null; return; } else return; }
      e.preventDefault();
      const d = Math.max(0, dy);
      sh.style.transform = `translateY(${d}px)`;
      bg.style.backgroundColor = `rgba(0,0,0,${.5 * Math.max(0, 1 - d / (sh.offsetHeight || 600))})`;
    }, { passive: false });
    const end = () => {
      if (y0 == null) return;
      const v = dy / Math.max(1, performance.now() - t0); y0 = null;
      if (!dragging) return;
      dragging = false; sh.classList.remove('dragging');
      if (dy > Math.min(140, sh.offsetHeight * .25) || v > .55) closeSheet(bg);
      else { sh.style.transform = ''; bg.style.backgroundColor = ''; }
    };
    sh.addEventListener('touchend', end); sh.addEventListener('touchcancel', end);
  }
  function closeSheet(bg) {
    if (!bg || bg.classList.contains('closing')) return;
    bg.classList.add('closing'); bg.classList.remove('open');
    const sh = $('.sheet', bg); sh.style.transform = ''; bg.style.backgroundColor = '';
    setTimeout(() => bg.remove(), 280);
  }

  /* ---------- Connect MT5 ---------- */
  function openConnect() {
    let method = 'new', mode = S.conn.mode;
    const intro = {
      demo: 'Practice with a simulated market and $10,000 of virtual money. No account needed.',
      mt5: 'Connect through <b>MetaApi</b> (metaapi.cloud), a paid cloud service that runs MT5 for you. No PC needed.',
      bridge: 'Connect to <b>your own Windows PC or VPS</b> running MT5 and the free Tradebot bridge. Your MT5 password never leaves your server. See the VPS guide in the GitHub repo.',
    };
    sheet(`<h2>Configure MT5 account</h2>
      <div class="seg" id="cmode" style="margin:12px 0 8px"><button data-m="demo" class="${mode === 'demo' ? 'on' : ''}">Paper</button><button data-m="bridge" class="${mode === 'bridge' ? 'on' : ''}">Own VPS</button><button data-m="mt5" class="${mode === 'mt5' ? 'on' : ''}">MetaApi</button></div>
      <p class="sub" id="cintro" style="margin:0 0 12px">${intro[mode]}</p>
      <div id="bridgeform" class="${mode === 'bridge' ? '' : 'hidden'}">
        <div class="field"><label>Bridge URL</label><input class="input mono" id="burl" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://1-2-3-4.sslip.io" value="${esc(S.conn.url || '')}"><div class="hint">Shown at the end of the installer and saved in C:\\Tradebot\\CONNECTION.txt on your VPS.</div></div>
        <div class="field"><label>Access key</label><input class="input mono" id="bkey" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${mode === 'bridge' ? 'Saved securely. Leave blank to keep it.' : 'Paste access key'}"></div>
      </div>
      <div id="mt5form" class="${mode === 'mt5' ? '' : 'hidden'}">
        <div class="field"><label>MetaApi API token</label><input class="input mono" id="tok" type="password" placeholder="${mode === 'mt5' ? 'Saved securely. Leave blank to keep it.' : 'Paste token'}"></div>
        <div class="seg" id="cmeth" style="margin-bottom:12px"><button data-m="new" class="on">Add MT5 login</button><button data-m="id">Existing MetaApi account ID</button></div>
        <div id="fnew"><div class="field"><label>MT5 login</label><input class="input mono" id="lg" inputmode="numeric" value="${esc(S.conn.login || '')}"></div>
          <div class="field"><label>MT5 password (trading)</label><input class="input" id="pw" type="password"><div class="hint">Sent once to MetaApi to register the account; never stored on this phone.</div></div>
          <div class="field"><label>Broker server</label><input class="input" id="sv" placeholder="e.g. XMGlobal-MT5 2" value="${esc(S.conn.server || '')}"></div></div>
        <div id="fid" class="hidden"><div class="field"><label>MetaApi account ID</label><input class="input mono" id="aid" value="${esc(S.conn.accountId || '')}"></div></div>
      </div>
      <div class="notice ${mode === 'demo' ? 'hidden' : ''}" id="cwarn" style="margin-bottom:12px">Use a <b>demo MT5 account</b> first. Live trading carries real financial risk.</div>
      <div class="sub" id="cstat" style="margin-bottom:10px"></div>
      <button class="btn" id="cgo">Save & connect</button>`, el => {
      $$('#cmode button', el).forEach(b => b.onclick = () => {
        mode = b.dataset.m; $$('#cmode button', el).forEach(x => x.classList.toggle('on', x === b));
        $('#mt5form', el).classList.toggle('hidden', mode !== 'mt5'); $('#bridgeform', el).classList.toggle('hidden', mode !== 'bridge');
        $('#cwarn', el).classList.toggle('hidden', mode === 'demo'); $('#cintro', el).innerHTML = intro[mode]; $('#cstat', el).textContent = '';
      });
      $$('#cmeth button', el).forEach(b => b.onclick = () => { method = b.dataset.m; $$('#cmeth button', el).forEach(x => x.classList.toggle('on', x === b)); $('#fnew', el).classList.toggle('hidden', method !== 'new'); $('#fid', el).classList.toggle('hidden', method !== 'id'); });
      $('#cgo', el).onclick = async () => {
        const st = $('#cstat', el), btn = $('#cgo', el);
        if (mode === 'demo') { S.bot.enabled = false; S.conn = { mode: 'demo' }; save(); closeSheet(el); await connectBroker(); toast('Switched to paper trading'); return; }
        btn.disabled = true;
        try {
          if (mode === 'bridge') {
            let url = $('#burl', el).value.trim().replace(/\/+$/, '');
            if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
            const key = $('#bkey', el).value.trim() || (S.conn.mode === 'bridge' ? await Security.getSecret('bridge') : '');
            if (!url) throw new Error('Enter the Bridge URL');
            if (!key) throw new Error('Enter the access key');
            if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) throw new Error('The bridge URL must start with https://');
            st.textContent = 'Checking the bridge…';
            const probe = new Brokers.BridgeBroker({ url, token: key });
            const info = await probe.connect(m => st.textContent = m);
            await Security.setSecret('bridge', key);
            S.bot.enabled = false; S.conn = { mode: 'bridge', url, login: String(info.login), server: info.server }; save();
            st.textContent = 'Connected. Loading your account…';
            await connectBroker();
            closeSheet(el); toast(`Connected to MT5 ${info.login} via your VPS`);
          } else {
            const token = $('#tok', el).value.trim() || await Security.getSecret('metaapi');
            if (!token) throw new Error('MetaApi token required');
            let accountId = $('#aid', el).value.trim(), login = $('#lg', el).value.trim(), server = $('#sv', el).value.trim();
            if (method === 'new') {
              if (!login || !$('#pw', el).value || !server) throw new Error('Login, password and server are required');
              st.textContent = 'Registering account with MetaApi…';
              accountId = await Brokers.MetaApiBroker.provision({ token, login, password: $('#pw', el).value, server, name: `${S.profile.name} MT5` });
              $('#pw', el).value = '';
            } else if (!accountId) throw new Error('Account ID required');
            await Security.setSecret('metaapi', token);
            S.bot.enabled = false; S.conn = { mode: 'mt5', accountId, login, server }; save();
            st.textContent = 'Deploying & connecting to broker (can take a minute)…';
            await connectBroker(s => st.textContent = 'Connecting… ' + s);
            closeSheet(el); toast('MT5 account connected');
          }
        } catch (e) { st.innerHTML = `<span class="down">${esc(e.message)}</span>`; }
        btn.disabled = false;
      };
    });
  }

  /* ================= CHARTS ================= */
  function setupCanvas(c) {
    if (!c.dataset.h) c.dataset.h = c.getAttribute('height');
    const H = +c.dataset.h, d = devicePixelRatio || 1; c.style.height = H + 'px';
    const W = c.getBoundingClientRect().width; c.width = W * d; c.height = H * d;
    const x = c.getContext('2d'); x.setTransform(d, 0, 0, d, 0, 0); return [x, W, H];
  }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  async function drawChart(c, sym, levels = []) {
    if (!c || !S.broker) return;
    let candles = S.candleCache[sym]; if (!candles) return;
    candles = candles.slice(-70);
    const [x, w, h] = setupCanvas(c); const pad = { l: 4, r: 54, t: 8, b: 16 };
    let hi = Math.max(...candles.map(k => k.high), ...levels.map(l => l.price)), lo = Math.min(...candles.map(k => k.low), ...levels.map(l => l.price));
    if (levels.length) { const m = (hi - lo) * .04; hi += m; lo -= m; }
    const rng = hi - lo || 1;
    const Y = v => pad.t + (hi - v) / rng * (h - pad.t - pad.b), cw = (w - pad.l - pad.r) / candles.length;
    x.strokeStyle = css('--line'); x.fillStyle = css('--muted'); x.font = '10px system-ui'; x.lineWidth = 1;
    const tags = [candles.at(-1).close, ...levels.map(l => l.price)].map(Y);
    for (let i = 0; i <= 4; i++) { const v = lo + rng * i / 4, y = Y(v); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); if (!tags.some(t => Math.abs(t - y) < 14)) x.fillText(px(sym, v), w - pad.r + 4, y + 3); }
    const closesAll = S.candleCache[sym].map(k => k.close), off = closesAll.length - candles.length;
    [[Engine.ema(closesAll, 20), css('--accent')], [Engine.ema(closesAll, 50), css('--warn')]].forEach(([e, col]) => { x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); candles.forEach((_, i) => { const X = pad.l + i * cw + cw / 2, y = Y(e[off + i]); i ? x.lineTo(X, y) : x.moveTo(X, y); }); x.stroke(); });
    candles.forEach((k, i) => { const up = k.close >= k.open, col = up ? css('--up') : css('--down'), X = pad.l + i * cw + cw / 2; x.strokeStyle = x.fillStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(X, Y(k.high)); x.lineTo(X, Y(k.low)); x.stroke(); const bh = Math.max(1, Math.abs(Y(k.open) - Y(k.close))); x.fillRect(X - cw * .35, Math.min(Y(k.open), Y(k.close)), cw * .7, bh); });
    const last = candles.at(-1).close, ly = Y(last); x.setLineDash([3, 3]); x.strokeStyle = css('--accent'); x.beginPath(); x.moveTo(pad.l, ly); x.lineTo(w - pad.r, ly); x.stroke(); x.setLineDash([]);
    x.fillStyle = css('--accent'); x.fillRect(w - pad.r + 1, ly - 8, pad.r - 1, 16); x.fillStyle = '#fff'; x.font = 'bold 10px system-ui'; x.fillText(px(sym, last), w - pad.r + 4, ly + 3);
    x.fillStyle = css('--muted'); x.font = '10px system-ui'; x.fillText('EMA20', pad.l + 2, h - 3); x.fillStyle = css('--warn'); x.fillText('EMA50', pad.l + 44, h - 3);
    // Trade levels: a line across the chart, a tag on the price axis and a label on the left
    levels.forEach(l => {
      const y = Y(l.price), col = css(l.color); x.strokeStyle = col; x.lineWidth = 1.5; x.setLineDash(l.dash ? [6, 4] : []);
      x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); x.setLineDash([]);
      x.fillStyle = col; x.fillRect(w - pad.r + 1, y - 8, pad.r - 1, 16); x.fillStyle = '#fff'; x.font = 'bold 10px system-ui'; x.fillText(px(sym, l.price), w - pad.r + 4, y + 3);
      x.font = 'bold 10px system-ui'; const tw = x.measureText(l.label).width + 10, ty = Math.min(Math.max(y - 16, pad.t), h - pad.b - 14);
      x.fillStyle = css('--card'); x.globalAlpha = .85; x.fillRect(pad.l + 2, ty, tw, 13); x.globalAlpha = 1; x.fillStyle = col; x.fillText(l.label, pad.l + 7, ty + 10);
    });
  }
  function drawLine(c, pts) {
    if (!c || pts.length < 2) return; const [x, w, h] = setupCanvas(c);
    const hi = Math.max(...pts), lo = Math.min(...pts), r = hi - lo || 1, X = i => i / (pts.length - 1) * w, Y = v => 6 + (hi - v) / r * (h - 12);
    const col = pts.at(-1) >= pts[0] ? css('--up') : css('--down');
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
    x.beginPath(); pts.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(0, Y(v))); x.lineTo(w, h); x.lineTo(0, h); x.fillStyle = g; x.fill();
    x.beginPath(); pts.forEach((v, i) => i ? x.lineTo(X(i), Y(v)) : x.moveTo(0, Y(v))); x.strokeStyle = col; x.lineWidth = 2; x.stroke();
  }

  /* ================= DATA + AUTO-TRADER ================= */
  /* Symbol catalogue with categories (MT5 folder path when available, otherwise name rules). */
  const CATS = ['Forex', 'Metals', 'Energy', 'Indices', 'Crypto', 'Stocks', 'Other'];
  const CAT_ICON = { Forex: '💱', Metals: '🥇', Energy: '🛢️', Indices: '📊', Crypto: '₿', Stocks: '🏢', Other: '•' };
  function categorize(name, path = '') {
    const p = path.toLowerCase(), n = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (p) {
      if (/forex|fx|currenc/.test(p)) return 'Forex';
      if (/metal|gold|silver|precious/.test(p)) return 'Metals';
      if (/energ|oil|gas|commod/.test(p)) return /gold|silver|metal/.test(p) ? 'Metals' : 'Energy';
      if (/indic|index|cash|cfd ind/.test(p)) return 'Indices';
      if (/crypto|coin/.test(p)) return 'Crypto';
      if (/stock|share|equit/.test(p)) return 'Stocks';
    }
    if (/^(XAU|XAG|XPT|XPD|GOLD|SILVER|PLATINUM|PALLADIUM|COPPER)/.test(n)) return 'Metals';
    if (/(OIL|WTI|BRENT|NGAS|NATGAS|GASOLINE)/.test(n)) return 'Energy';
    if (/^(BTC|ETH|LTC|XRP|ADA|SOL|DOGE|DOT|BCH|BNB)/.test(n)) return 'Crypto';
    if (/^(US30|US500|USTEC|NAS|SPX|SP500|DJ|GER|DE40|DAX|UK100|FTSE|JP225|NIKKEI|FRA40|EU50|STOXX|AUS200|HK50|CHINA|US2000)/.test(n)) return 'Indices';
    if (/^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|SGD|HKD|NOK|SEK|DKK|ZAR|MXN|TRY|PLN|CNH|HUF|CZK)(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF|SGD|HKD|NOK|SEK|DKK|ZAR|MXN|TRY|PLN|CNH|HUF|CZK)/.test(n)) return 'Forex';
    return 'Other';
  }
  async function loadCatalog() {
    let rows = [];
    try { rows = await S.broker.getCatalog(); } catch { rows = (await S.broker.getSymbols()).map(name => ({ name })); }
    S.catalog = rows.map(r => ({ name: r.name, desc: r.desc || '', cat: r.cat || categorize(r.name, r.path) }));
    S.allSymbols = S.catalog.map(r => r.name);
  }
  /* Brokers name symbols differently (EURUSD., EURUSD#, GOLD…). Map the watch list onto the broker's names. */
  const SYMBOL_ALIASES = { XAUUSD: ['GOLD'], XAGUSD: ['SILVER'], US30: ['US30CASH', 'DJ30', 'WS30', 'DOWJONES'], BTCUSD: ['BITCOIN', 'BTCUSDT'] };
  function mapWatchSymbols() {
    const all = S.allSymbols || []; if (!all.length) return;
    const norm = x => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const find = s => { if (all.includes(s)) return s; for (const c of [norm(s), ...(SYMBOL_ALIASES[norm(s)] || [])]) { const hit = all.find(x => norm(x) === c) || all.find(x => norm(x).startsWith(c)); if (hit) return hit; } return null; };
    const before = S.bot.symbols.join(', ');
    let mapped = [...new Set(S.bot.symbols.map(find).filter(Boolean))];
    if (!mapped.length) mapped = all.slice(0, 4);
    S.bot.symbols = mapped; if (!mapped.includes(S.focus)) S.focus = mapped[0];
    if (mapped.join(', ') !== before) log(`Watch list matched to your broker's symbols: ${mapped.join(', ')}`);
    save();
  }
  /* $ gained per 1.0 price move for 1 lot. Exact from MT5's tick value when the broker provides it
     (works for FX crosses, metals, oil, indices…); otherwise contract size with a quote-currency estimate. */
  const valuePerUnit = (sym, spec, price) => spec.tickValue > 0 && spec.tickSize > 0 ? spec.tickValue / spec.tickSize : (spec.contractSize || 1) / quoteConv(sym, spec, price);
  /* Profit-currency conversion: 1 when P/L is already in USD, price when the quote currency isn't (e.g. USDJPY). */
  const quoteConv = (sym, spec, price) => {
    if (spec?.currencyProfit) return spec.currencyProfit === 'USD' ? 1 : (/^USD/i.test(sym) ? price : 1);
    const n = sym.toUpperCase().replace(/[^A-Z]/g, ''); return (/^USD/.test(n) && !/USD$/.test(n)) ? price : 1;
  };
  S.candleCache = {};
  async function connectBroker(onStatus) {
    S.broker?.destroy?.(); S.status = 'Connecting'; S.candleCache = {}; resetSeries(); D.stat = {}; S.htf = {};
    if (S.conn.mode === 'bridge') {
      S.broker = new Brokers.BridgeBroker({ url: S.conn.url, token: await Security.getSecret('bridge') });
      try {
        const info = await S.broker.connect(onStatus); S.status = 'Connected'; S.bridgeVersion = info.version;
        log(`Connected to MT5 ${info.login} (${info.server}) via your VPS`, 'up');
        if (!info.tradeAllowed) { log('Algo Trading is OFF in MetaTrader 5. Turn it on, or orders will be rejected.', 'down'); toast('Turn on "Algo Trading" in MT5 on your VPS'); }
      } catch (e) { S.status = 'Error'; log('Bridge connection failed: ' + e.message, 'down'); throw e; }
      try { await loadCatalog(); mapWatchSymbols(); } catch { }
    } else if (S.conn.mode === 'mt5') {
      const token = await Security.getSecret('metaapi');
      S.broker = new Brokers.MetaApiBroker({ token, accountId: S.conn.accountId, region: S.conn.region });
      try { await S.broker.connect(onStatus); S.conn.region = S.broker.region; save(); S.status = 'Connected'; log('Connected to MT5 account', 'up'); }
      catch (e) { S.status = 'Error'; log('MT5 connection failed: ' + e.message, 'down'); throw e; }
      try { await loadCatalog(); mapWatchSymbols(); } catch { }
    } else {
      S.broker = new Brokers.DemoBroker(store); S.status = 'Connected'; await loadCatalog();
      S.broker.onEvent = ev => { if (ev.type === 'closed' && ev.deal.reason !== 'Manual') log(`${ev.deal.reason} hit on ${ev.deal.symbol}: ${signed(ev.deal.profit)}`, cls(ev.deal.profit)); };
    }
    S.pollMs = S.conn.mode === 'mt5' ? 5000 : 1000;
    if (pollT) { clearInterval(pollT); pollT = setInterval(poll, S.pollMs); }
    S.candleCache = {}; resetSeries(); await poll(); await analyseAll(); scheduleBot(true);
  }
  async function poll() {
    if (!S.broker || S._polling) return;           // skip a beat rather than overlap if the last refresh is still running
    S._polling = true; ringBusy(true);
    try {
      [S.account, S.positions] = await Promise.all([S.broker.getAccount(), S.broker.getPositions()]);
      if (!S._histT || Date.now() - S._histT > (isLive() ? 60000 : 0)) { S.history = await S.broker.getHistory(); S._histT = Date.now(); }
      const today = new Date().toDateString();
      if (!S.dayStart || S.dayStart.day !== today) { S.dayStart = { day: today, equity: S.account.equity }; store.set('dayStart', S.dayStart); }
      if (isLive()) S.status = 'Connected';
      checkBasket();
      journalReconcile(); journalBackfill();
      if (S.bot.enabled && !S._protecting) { S._protecting = true; protectProfits().finally(() => S._protecting = false); }
    } catch (e) { S.status = 'Error'; }
    S._polling = false; refreshLive(); ringBusy(false); ringCycle();
  }
  /* Basket targets: close all bot trades together at a combined $ profit or loss. */
  function checkBasket() {
    const b = S.bot; if (!b.enabled || S._basketBusy || !(b.basketTp > 0 || b.basketSl > 0)) return;
    const bp = S.positions.filter(isBot); if (!bp.length) return;
    const tot = bp.reduce((x, p) => x + p.profit, 0);
    const hitTp = b.basketTp > 0 && tot >= b.basketTp, hitSl = b.basketSl > 0 && tot <= -b.basketSl;
    if (!hitTp && !hitSl) return;
    S._basketBusy = true;
    log(`Basket ${hitTp ? 'take-profit' : 'stop-loss'} reached (${signed(tot)}): closing ${bp.length} bot trade${bp.length === 1 ? '' : 's'}`, hitTp ? 'up' : 'down');
    notify(`Tradebot basket ${hitTp ? 'target' : 'stop'} hit`, `Closed ${bp.length} bot trades at ${signed(tot)}`);
    closeAll('bot', false, hitTp ? 'Basket TP' : 'Basket SL').finally(() => { S._basketBusy = false; });
  }
  const todayPnl = () => S.account && S.dayStart ? S.account.equity - S.dayStart.equity : 0;

  /* ===================== Market data loader =====================
     Keeps broker load flat as the number of symbols grows (see docs/ARCHITECTURE.md → Market data loading).
       • Request queue: at most N broker data requests at once (MetaApi 4, below its 5-per-account limit on
         historical data; Own VPS 2, since the bridge serves MT5 one call at a time; Paper unlimited).
       • Incremental candles: 200 candles once per symbol/timeframe (and every 6 h to self-heal), then only the
         last 3, merged in by candle time.
       • Due times: a symbol is refreshed only when due, every tf/15 between 20 s and 2 min on live accounts
         (15m → 60 s), every scan on Paper, and each symbol's slot is staggered so they don't all fire together.
       • Health: per-symbol last success / consecutive failures, shown on Auto-Trade.
     The analysis and the bot's decisions are unchanged: same 200 closed+forming candles, same engine. */
  const D = { q: [], active: 0, store: {}, stat: {} };
  const poolSize = () => S.conn?.mode === 'mt5' ? 4 : S.conn?.mode === 'bridge' ? 2 : 64;
  function queued(fn) {
    return new Promise((res, rej) => { D.q.push([fn, res, rej]); pump(); });
  }
  function pump() {
    while (D.active < poolSize() && D.q.length) {
      const [fn, res, rej] = D.q.shift(); D.active++;
      Promise.resolve().then(fn).then(res, rej).finally(() => { D.active--; pump(); });
    }
  }
  const TFMS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };
  const dueEvery = tf => S.conn?.mode === 'demo' ? 0 : Math.max(2e4, Math.min(12e4, (TFMS[tf] || 9e5) / 15));
  const FULL_EVERY = 6 * 36e5, FULL_N = 200, INC_N = 3;
  D.reqs = { full: 0, inc: 0, fail: 0 };   // counters (Profile → About shows them; tests read them)
  /* Candles for sym/tf, refreshed only when due. Returns the cached series (possibly stale) or throws if none. */
  async function getSeries(sym, tf, { n = FULL_N, slot = 0, of = 1 } = {}) {
    const key = sym + '|' + tf, c = D.store[key], now = Date.now(), every = dueEvery(tf);
    if (c && now < c.due) return c.k;
    const full = !c || c.k.length < 60 || now - c.fullAt > FULL_EVERY || c.tf !== tf;
    try {
      let fresh = await queued(() => S.broker.getCandles(sym, tf, full ? n : INC_N)), wasFull = full;
      if (!Array.isArray(fresh) || !fresh.length) throw new Error('no candles');
      // gap check: if the 3 newest candles don't overlap what we have (app was asleep), download the full series
      if (!full && fresh[0].time > c.k.at(-1).time) { fresh = await queued(() => S.broker.getCandles(sym, tf, n)); wasFull = true; D.reqs.gapFix = (D.reqs.gapFix || 0) + 1; }
      let k;
      if (wasFull) k = fresh;
      else {   // merge by time: replace the forming candle, append new ones
        k = c.k.slice(); const last = k.at(-1).time;
        fresh.forEach(x => { if (x.time > last) k.push(x); else { const i = k.findIndex(y => y.time === x.time); if (i >= 0) k[i] = x; } });
        if (k.length > n) k = k.slice(-n);
      }
      // stagger: symbol #slot of #of gets its own offset inside the refresh window
      D.store[key] = { k, tf, fullAt: wasFull ? now : c.fullAt, due: now + every * (1 + (of > 1 ? slot / of * .5 : 0)) };
      D.reqs[wasFull ? 'full' : 'inc']++;
      const st = (D.stat[sym] ||= {}); st.ok = now; st.fails = 0; st.err = '';
      return k;
    } catch (e) {
      D.reqs.fail++;
      const st = (D.stat[sym] ||= {}); st.fails = (st.fails || 0) + 1; st.err = e.message || String(e);
      if (c) { c.due = now + Math.min(6e4, 5e3 * st.fails); return c.k; }   // keep the last good data, retry with backoff
      throw e;
    }
  }
  function resetSeries() { D.store = {}; }
  /* Auto-Trade status line: how many watched symbols are up to date. */
  function dataHealthHtml() {
    const w = watch(), now = Date.now(), lim = Math.max(dueEvery(S.bot.timeframe) * 2.5, 6e4);
    const ok = w.filter(x => D.stat[x]?.ok && now - D.stat[x].ok < lim && !(D.stat[x].fails >= 3)), bad = w.filter(x => D.stat[x]?.fails >= 3);
    const last = Math.max(0, ...w.map(x => D.stat[x]?.ok || 0));
    if (!last) return '<span class="sub">Loading market data…</span>';
    return `<span class="sub">${ok.length === w.length ? '✅' : '⚠️'} ${ok.length} of ${w.length} symbols up to date · last update ${relTime(last).replace('in ', '')}${S.conn?.mode !== 'demo' ? ` · refresh every ${Math.round(dueEvery(S.bot.timeframe) / 1000)} s, up to ${poolSize()} at a time` : ''}</span>
      ${bad.length ? `<div class="sub down" style="margin-top:4px">Not updating: ${bad.map(x => `${x} (${esc(D.stat[x].err).slice(0, 60)})`).join(', ')}. The bot skips these until data comes back.</div>` : ''}`;
  }
  async function analyseAll() {
    if (!S.broker) return;
    const syms = [...new Set([...watch(), ...(S.tab === 'markets' ? (S.marketVisible || []).slice(0, 30) : [])])];
    await Promise.all([Brokers.Calendar.refresh(), Brokers.News.refresh(S.newsKey)]).catch(() => { });
    const W = watch();
    await Promise.all(syms.map(async (s, i) => {
      try {
        const c = await getSeries(s, S.bot.timeframe, { slot: i, of: syms.length });
        if (S.candleCache[s] === c && S.analysis[s]) return;      // nothing new since the last analysis
        S.candleCache[s] = c;
        if (S.conn.mode !== 'demo' && !(s in (S.digitsOf ||= {}))) { try { S.digitsOf[s] = (await queued(() => S.broker.getSpec(s))).digits; } catch { } }
        const news = Brokers.News.forSymbol(s, S.newsKey);
        S.analysis[s] = Engine.analyse(c, { threshold: S.bot.threshold, news });
        // The bot decides on CLOSED candles only: the last candle is still forming and its
        // score swings tick by tick, which made the bot enter and exit on noise.
        const done = c.slice(0, -1);
        (S.botAnalysis ||= {})[s] = Engine.analyse(done, { threshold: S.bot.threshold, news });
        (S.barKey ||= {})[s] = done.at(-1)?.time;
        if (S.bot.htfFilter && W.includes(s)) await loadHtf(s);
      } catch (e) { /* symbol unavailable */ }
    }));
    S.mood = Engine.marketMood(watch().map(s => S.analysis[s]));
    const dh = document.getElementById('datahealth'); if (dh) dh.innerHTML = dataHealthHtml();
    refreshLive();
  }

  /* Higher-timeframe trend (EMA20 vs EMA50 on closed candles), refreshed every 5 minutes. */
  async function loadHtf(sym) {
    const tf = HTF[S.bot.timeframe] || '1h', key = sym + tf, c = (S.htf ||= {})[key];
    if (c && Date.now() - c.t < 3e5) return;
    try {
      const k = (await queued(() => S.broker.getCandles(sym, tf, 120))).slice(0, -1), a = Engine.analyse(k, {});
      S.htf[key] = { t: Date.now(), up: a ? a.ema20 > a.ema50 : null };
    } catch { S.htf[key] = { t: Date.now(), up: null }; }
  }
  /* null = no data (don't block), true/false = trade allowed in that direction. */
  function htfOk(sym, side) {
    if (!S.bot.htfFilter) return true;
    const h = S.htf?.[sym + (HTF[S.bot.timeframe] || '1h')]; if (!h || h.up == null) return null;
    return side === 'BUY' ? h.up : !h.up;
  }
  /* Bot's view of a symbol: closed-candle analysis + decision + higher-timeframe gate. */
  function botDecision(sym) {
    const a = S.botAnalysis?.[sym] || S.analysis[sym], d = Engine.decide(a, S.bot.strategy, S.mood, S.bot);
    if (d.action !== 'HOLD' && htfOk(sym, d.action) === false) { d.why += ` · ${HTF[S.bot.timeframe]} trend against`; d.blocked = d.action; d.action = 'HOLD'; }
    const gb = guardBlock(sym, d.strategy);
    if (gb) { d.why = `🛡 Paused by guardrail: ${gb[1]} kept losing`; if (d.action !== 'HOLD') { d.blocked = d.action; d.action = 'HOLD'; } }
    const ev = S.bot.newsPause ? Brokers.Calendar.blackout(sym) : null;
    if (ev) { d.why = `⏸ News pause: ${ev.ccy} ${ev.title} ${relTime(ev.time)}`; d.news = ev; if (d.action !== 'HOLD') { d.blocked = d.action; d.action = 'HOLD'; } }
    return [a, d];
  }

  function lotFor(sym, a, spec, slMult = S.bot.slAtr, riskMult = 1) {
    const eq = S.account.equity, risk = eq * S.bot.riskPct / 100 * riskMult, slDist = a.atr * slMult;
    const perLot = slDist * valuePerUnit(sym, spec, a.price);
    let vol = risk / (perLot || 1e9);
    const step = spec.volumeStep || .01; vol = Math.floor(vol / step) * step;
    return +Math.min(Math.max(vol, spec.minVolume || .01), spec.maxVolume || 100, S.bot.maxLot).toFixed(2);
  }
  /* Fixed-$ mode: choose a lot so the take-profit sits ~tpAtr × ATR away, then derive exact price
     distances from that (rounded) lot so profit at TP = tpUsd and loss at SL = slUsd. */
  function usdPlan(sym, a, spec, tpAtr = S.bot.tpAtr, lotOverride) {
    const vpu = valuePerUnit(sym, spec, a.price), step = spec.volumeStep || .01, minV = spec.minVolume || .01;
    let lot = lotOverride || Math.round(S.bot.tpUsd / (tpAtr * a.atr * vpu) / step) * step;
    lot = +Math.min(Math.max(lot, minV), spec.maxVolume || 100, lotOverride ? Infinity : S.bot.maxLot).toFixed(2);
    return { lot, tpDist: S.bot.tpUsd / (lot * vpu), slDist: S.bot.slUsd / (lot * vpu) };
  }
  /* Would the fixed-$ target sit too close to the price at this lot? Also returns the lot that fits. */
  async function usdFit(sym, volume) {
    const a = S.analysis[sym]; if (!a) return null;
    const spec = await S.broker.getSpec(sym), q = await S.broker.getPrice(sym), spread = q.ask - q.bid;
    const mine = usdPlan(sym, a, spec, S.bot.tpAtr, volume), auto = usdPlan(sym, a, spec, S.bot.tpAtr);
    const tight = p => Math.min(p.slDist, p.tpDist) < spread * 3;
    return { tight: tight(mine), dist: Math.min(mine.slDist, mine.tpDist), spread, suggested: auto.lot, suggestedOk: !tight(auto) };
  }
  async function placeOrder(sym, side, volume, comment, opt = {}) {
    const slM = opt.slAtr ?? S.bot.slAtr, tpM = opt.tpAtr ?? S.bot.tpAtr;
    const a = S.analysis[sym], spec = await S.broker.getSpec(sym), q = await S.broker.getPrice(sym);
    const entry = side === 'BUY' ? q.ask : q.bid, d = spec.digits ?? digits(sym), r = v => +v.toFixed(d);
    const atr = a?.atr || 0;
    let slD = atr * slM, tpD = atr * tpM;
    const usdMode = S.bot.targetMode === 'usd' && a && !opt.forceAtr;
    if (usdMode) {
      const plan = usdPlan(sym, a, spec, tpM, volume); slD = plan.slDist; tpD = plan.tpDist;
      if (Math.min(slD, tpD) < (q.ask - q.bid) * 3) throw new Error(`$ target too small for ${sym} spread at ${volume} lot`);
    }
    const sl = slD ? r(side === 'BUY' ? entry - slD : entry + slD) : undefined;
    const tp = tpD ? r(side === 'BUY' ? entry + tpD : entry - tpD) : undefined;
    const res = await S.broker.trade({ symbol: sym, side, volume, stopLoss: sl, takeProfit: tp, comment });
    try { journalOpen({ id: res?.positionId ?? res?.orderId ?? null, sym, side, volume, entry, sl, tp, spec, src: opt.src || (comment === 'Manual' ? 'manual' : 'bot'), ctx: opt.ctx || journalCtx(sym, a, null) }); } catch { }
    log(`${opt.tag ? opt.tag + ' ' : ''}${side} ${volume} ${sym} @ ${px(sym, entry)} · SL ${sl ? px(sym, sl) : '—'} TP ${tp ? px(sym, tp) : '—'}${usdMode ? ` (+$${fmt(S.bot.tpUsd)} / −$${fmt(S.bot.slUsd)})` : ''}`, side === 'BUY' ? 'up' : 'down');
    return res;
  }

  let botBusy = false;
  async function botCycle() {
    if (!S.bot.enabled || !S.broker || botBusy) return; botBusy = true;
    try {
      await poll(); await analyseAll();
      // Daily loss guard
      const lossLimit = (S.dayStart?.equity || 0) * S.bot.dailyLossPct / 100;
      if (todayPnl() <= -lossLimit) { S.bot.enabled = false; S.bot.pausedReason = 'Daily loss limit hit'; save(); log(`Daily loss limit (-${S.bot.dailyLossPct}%) reached — bot paused`, 'down'); notify('Tradebot paused', 'Daily loss limit reached.'); refreshLive(); return; }
      const mine = S.positions.filter(p => isBot(p));
      // Work only once per newly closed candle per symbol (the scan interval just checks for one).
      const seen = (S.botSeen ||= {}), fresh = {};
      watch().concat(mine.map(p => p.symbol)).forEach(s => { const k = S.barKey?.[s]; if (k != null && seen[s] !== k) { fresh[s] = true; seen[s] = k; } });
      const bars = (S.posBars ||= store.get('posBars') || {});
      mine.forEach(p => { if (!(p.id in bars)) bars[p.id] = Date.now() - p.time > 6e5 ? FLIP_MIN_BARS : 0; else if (fresh[p.symbol]) bars[p.id]++; });
      Object.keys(bars).forEach(id => { if (!mine.some(p => String(p.id) === id)) delete bars[id]; });
      store.set('posBars', bars);
      // Exits: trend/breakout/sentiment trades close when sentiment turns STRONGLY against them
      // (1.5× the entry threshold, after 4+ closed candles); reversion trades exit at the middle band.
      for (const p of mine) {
        const a = S.botAnalysis?.[p.symbol]; if (!a || !fresh[p.symbol]) continue;
        const buy = p.type === 'POSITION_TYPE_BUY', st = stratOf(p), lim = S.bot.threshold * FLIP_MULT;
        let why = '';
        if (st === 'reversion') { if (buy ? a.bb.pctB >= .5 : a.bb.pctB <= .5) why = 'Back to mean'; }
        else if (S.bot.exitOnFlip && bars[p.id] >= FLIP_MIN_BARS && (buy ? a.score <= -lim : a.score >= lim)) why = `Sentiment flipped (${a.score})`;
        if (why) { try { await S.broker.closePosition(p.id, st === 'reversion' ? 'Bot: back to mean' : 'Bot: sentiment flip'); log(`${why} on ${p.symbol}: closed ${signed(p.profit)}`, cls(p.profit)); } catch (e) { log(`Close ${p.symbol} failed: ${e.message}`, 'down'); } }
      }
      // Entries
      await poll();
      let open = S.positions.filter(p => isBot(p)).length;
      const cands = watch().filter(s => fresh[s]).map(s => [s, ...botDecision(s)]).filter(([, , d]) => d.action !== 'HOLD')
        .sort((x, y) => Math.abs(y[1].score) * y[2].riskMult - Math.abs(x[1].score) * x[2].riskMult);
      for (const [s, a, d] of cands) {
        if (open >= S.bot.maxPositions) break;
        if (S.positions.some(p => p.symbol === s)) continue;
        const spec = await S.broker.getSpec(s);
        const plan = S.bot.targetMode === 'usd' ? usdPlan(s, a, spec, d.tpAtr) : null;
        const vol = plan ? plan.lot : lotFor(s, a, spec, d.slAtr, d.riskMult);
        // Spread guard: skip when the spread is more than 10% of the stop distance (a cost the trade rarely earns back)
        try { const q = await S.broker.getPrice(s), sp = q.ask - q.bid, slD = plan ? plan.slDist : a.atr * d.slAtr;
          if (sp > slD * SPREAD_MAX) { if ((S._spreadLog ||= {})[s] !== S.barKey[s]) { S._spreadLog[s] = S.barKey[s]; log(`Skipped ${s}: spread is ${Math.round(sp / slD * 100)}% of the stop distance`, ''); } continue; } } catch { }
        const st = Engine.STRATEGIES[d.strategy];
        try { await placeOrder(s, d.action, vol, `TB ${STRAT_CODE[d.strategy]}${a.score > 0 ? '+' : ''}${a.score}`, { slAtr: d.slAtr, tpAtr: d.tpAtr, tag: st.icon + ' ' + st.label + ':', src: 'bot', ctx: journalCtx(s, a, d) }); open++; notify(`Tradebot ${d.action} ${s}`, `${st.label} · ${vol} lot · ${d.why}`); }
        catch (e) { log(`Order ${s} failed: ${e.message}`, 'down'); }
      }
      await poll();
    } catch (e) { log('Bot error: ' + e.message, 'down'); }
    finally { botBusy = false; }
  }
  /* Protect profits (trailing stop). R = the trade's original stop distance. Once price is TRAIL_R × R in
     profit, the stop-loss is moved to price − R (buy) / price + R (sell), and only ever tightened.
     Tested on real M1 data: Balanced +41 R → +47 R (Jun 25–May 26) and +8.7 R → +12.5 R (Jan–May 25). */
  async function protectProfits() {
    const meta = (S.posMeta ||= store.get('posMeta') || {}), mine = S.positions.filter(isBot);
    for (const p of mine) {
      const dir = p.type === 'POSITION_TYPE_BUY' ? 1 : -1, open = p.openPrice;
      if (!meta[p.id]) {  // first sight: the original risk distance
        let r = p.stopLoss && (open - p.stopLoss) * dir > 0 ? Math.abs(open - p.stopLoss) : 0;
        if (!r && p.takeProfit) r = Math.abs(p.takeProfit - open) * S.bot.slAtr / S.bot.tpAtr;
        meta[p.id] = { r };
      }
    }
    Object.keys(meta).forEach(id => { if (!mine.some(p => String(p.id) === id)) delete meta[id]; });
    store.set('posMeta', meta);
    if (!S.bot.trailing || S._noModify || typeof S.broker.modifyPosition !== 'function') return;
    for (const p of mine) {
      const r = meta[p.id]?.r, price = p.currentPrice; if (!r || !price) continue;
      const dir = p.type === 'POSITION_TYPE_BUY' ? 1 : -1, gain = (price - p.openPrice) * dir;
      const tight = S.bot.protectMode === 'tight', keep = S.bot.keepPct || .9, prog = tight && S.bot.keepFrom === 'prog', fromEntry = tight && S.bot.keepFrom !== 'r1';
      if (fromEntry ? gain <= 0 : gain < r * BE_R) continue;
      if (meta[p.id].errT && Date.now() - meta[p.id].errT < 10000) continue;          // broker refused recently: wait 10 s
      if (tight && meta[p.id].modT && Date.now() - meta[p.id].modT < 2000) continue;  // tight mode: at most one move per 2 s
      const d = S.specs?.[p.symbol]?.digits ?? S.digitsOf?.[p.symbol] ?? digits(p.symbol);
      // Stage 1 (from +0.5 R): stop to break-even (entry plus the spread, so a reversal closes at about $0).
      // Stage 2 (from +1 R): stop trails 1 R behind the price. Whichever is higher wins; the stop never moves back.
      let sp = 0; if (meta[p.id].sp == null) { try { const q = await S.broker.getPrice(p.symbol); meta[p.id].sp = Math.max(0, q.ask - q.bid); store.set('posMeta', meta); } catch { meta[p.id].sp = 0; } }
      sp = meta[p.id].sp;
      const be = p.openPrice + dir * sp;
      let target, stage;
      if (prog) {        // Progressive: keeps a growing share of the profit: 0.5 × profit-in-R, up to the cap (e.g. 90% from +1.8R)
        const f = keepShare(gain / r, keep); if (f <= 0) continue;
        target = p.openPrice + dir * gain * f; stage = 3;
      } else if (fromEntry) {   // Keep % from entry: from the first profit the stop always keeps e.g. 90% of the current profit
        target = p.openPrice + dir * gain * keep; stage = 3;
      } else if (tight) {   // Keep % from +1R: break-even from +0.5 R, then from +1 R the stop keeps a share of the current profit
        const t = gain >= r * TRAIL_R ? p.openPrice + dir * gain * keep : null;
        target = t != null && (t - be) * dir > 0 ? t : be; stage = target === be ? 1 : 3;
      } else {
        const trail = gain >= r * TRAIL_R ? price - dir * r * TRAIL_R : null;
        target = trail != null && (trail - be) * dir > 0 ? trail : be; stage = target === be ? 1 : 2;
      }
      const sl = +target.toFixed(d);
      if (p.stopLoss && (sl - p.stopLoss) * dir < (fromEntry ? Math.max(r * .01, 10 ** -d) : r * (tight ? .03 : .1))) continue;   // only forward, in small steps
      try {
        await S.broker.modifyPosition(p.id, { stopLoss: sl, takeProfit: p.takeProfit });
        const locked = p.profit * ((sl - p.openPrice) * dir) / gain;
        meta[p.id].stage = stage; meta[p.id].modT = Date.now(); meta[p.id].errT = 0; store.set('posMeta', meta);
        if (stage === 3) { if (!meta[p.id].tLog || Date.now() - meta[p.id].tLog > 60000) { meta[p.id].tLog = Date.now(); log(`🔒 ${p.symbol}: stop at ${px(p.symbol, sl)}, keeping ${Math.round((prog ? keepShare(gain / r, keep) : keep) * 100)}% of profit (locks ${signed(locked)})`, 'up'); } continue; }
        log(stage === 1 ? `🔒 ${p.symbol}: up ${fmt(gain / r, 2)}R, stop moved to break-even ${px(p.symbol, sl)}: this trade can no longer lose` : `🔒 ${p.symbol}: stop trailing at ${px(p.symbol, sl)} (locks ${signed(locked)})`, 'up');
      } catch (e) {
        if (/404|not found/i.test(e.message) && S.conn.mode === 'bridge') { S._noModify = true; log('Protect profits needs bridge 1.3.0: re-run install.ps1 on your VPS', 'down'); return; }
        meta[p.id].errT = Date.now();
        if (!meta[p.id].errLog) { meta[p.id].errLog = 1; log(`Couldn't move ${p.symbol} stop: ${e.message}${tight ? ' (the broker may not allow stops this close to the price; will retry)' : ''}`, 'down'); }
      }
    }
  }
  function notify(title, body) { try { window.Capacitor?.Plugins?.LocalNotifications?.schedule({ notifications: [{ id: Date.now() % 2e9, title, body }] }); } catch { } }

  let pollT, botT, anaT;
  function scheduleBot(restart) {
    clearInterval(botT);
    const iv = Math.max(isLive() ? 30 : 5, S.bot.intervalSec) * 1000;
    if (S.bot.enabled) { botT = setInterval(botCycle, iv); if (restart) botCycle(); }
  }
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    announceUpdate();
    S.pollMs = S.conn.mode === 'mt5' ? 5000 : 1000;
    try { await connectBroker(); } catch (e) { toast('Account offline: ' + e.message); }
    pollT = setInterval(poll, S.pollMs);
    anaT = setInterval(() => !S.bot.enabled && analyseAll(), isLive() ? 60000 : 6000);
    try { window.Capacitor?.Plugins?.LocalNotifications?.requestPermissions(); } catch { }
  }
  // Re-lock when app goes to background for > 60s
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (S.profile && S.unlocked && Date.now() - hiddenAt > 60000 && hiddenAt) { S.unlocked = false; render(); }
  });

  applyTheme(); applyHero(); applyFullscreen();
  render();
  window.Tradebot = S; window.TradebotJournal = J; window.TradebotData = D; // debugging
})();
