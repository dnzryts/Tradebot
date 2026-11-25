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
    conservative: { label: 'Conservative', riskPct: 0.5, threshold: 50, minConfidence: 60, maxPositions: 2, dailyLossPct: 2, slAtr: 2, tpAtr: 3 },
    balanced:     { label: 'Balanced',     riskPct: 1,   threshold: 40, minConfidence: 50, maxPositions: 3, dailyLossPct: 4, slAtr: 1.8, tpAtr: 3 },
    aggressive:   { label: 'Aggressive',   riskPct: 2,   threshold: 30, minConfidence: 40, maxPositions: 5, dailyLossPct: 8, slAtr: 1.5, tpAtr: 2.5 },
  };
  const DEFAULT_BOT = { enabled: false, symbols: ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD'], timeframe: '15m', strategy: 'auto', targetMode: 'atr', tpUsd: 3, slUsd: 3, basketTp: 0, basketSl: 0, maxLot: 1, exitOnFlip: true, intervalSec: 10, ...RISK_PRESETS.balanced, profile: 'balanced' };
  const THEMES = { midnight: ['#0b0f1a', '#6c8cff', '#9b6cff'], aurora: ['#04131a', '#19e3c3', '#4f9dff'], gold: ['#0e0c08', '#f2c14e', '#f08a4b'], light: ['#f3f5fb', '#4f6bff', '#8b5cf6'] };
  const AVATAR_COLORS = ['#6c8cff', '#19e3c3', '#f2c14e', '#ff5c7a', '#9b6cff', '#22d3a0'];

  const S = {
    profile: store.get('profile'),               // {name, email, pinHash, biometric, riskProfile, color, created}
    theme: (t => ['system', 'light'].includes(t) ? t : t ? 'midnight' : 'system')(store.get('themeV2') ? store.get('theme') : 'system'), // dark styles folded into Midnight
    systemDark: 'midnight',
    heroAlpha: store.get('heroAlpha') ?? 0.65,
    prefs: { confirmClose: 'always', hideByDefault: false, ...(store.get('prefs') || {}) },
    privacy: false,                                  // amounts hidden right now (eye button)   // confirmClose: always | loss | off      // dashboard card opacity (0.15–1)
    onboarded: store.get('onboarded') || false,
    conn: store.get('conn') || { mode: 'demo' },  // {mode:'demo'|'mt5', accountId, region, login, server}
    bot: { ...DEFAULT_BOT, ...(store.get('bot') || {}) },
    newsKey: store.get('newsKey') || '',
    log: store.get('log') || [],
    tab: 'home', broker: null, account: null, positions: [], history: [], analysis: {}, mood: null,
    pollMs: 0, focus: 'EURUSD', unlocked: false, status: 'Offline', dayStart: store.get('dayStart'),
  };
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
  const save = () => { store.set('bot', S.bot); store.set('conn', S.conn); store.set('profile', S.profile); store.set('theme', S.theme); store.set('heroAlpha', S.heroAlpha); store.set('prefs', S.prefs); };
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
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
    try { window.Capacitor?.Plugins?.ThemeBars?.set({ color: bg, light: t === 'light' }); } catch { }
  }
  /* Dashboard equity card opacity: CSS variable + readable text colours when it gets light. */
  function applyHero() {
    document.documentElement.style.setProperty('--hero-a', String(S.heroAlpha));
    $$('.card.hero').forEach(el => el.classList.toggle('soft', S.heroAlpha < .7));
  }
  function setTheme(t) { S.theme = t; store.set('themeV2', true); save(); applyTheme(); }
  darkMQ?.addEventListener?.('change', () => { if (S.theme === 'system') applyTheme(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(applyTheme, 150); });

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
    let risk = 'balanced', color = AVATAR_COLORS[0];
    app.innerHTML = `<div class="screen">
      <div class="brand" style="margin-bottom:26px">${logo}Tradebot</div>
      <h1>Create your <span class="grad-text">profile</span></h1>
      <p class="muted" style="margin-top:0">This stays on your device. You can change it anytime.</p>
      <div class="field"><label>Display name</label><input class="input" id="name" placeholder="e.g. Alex" maxlength="24"></div>
      <div class="field"><label>Email (optional)</label><input class="input" id="email" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Avatar colour</label><div class="row">${AVATAR_COLORS.map((c, k) => `<button class="avatar cpick" data-c="${c}" style="background:${c};width:36px;height:36px;border-radius:12px;${k ? '' : 'outline:3px solid var(--text)'}"></button>`).join('')}</div></div>
      <div class="field"><label>Risk profile</label><div class="seg" id="risk">${Object.entries(RISK_PRESETS).map(([k, v]) => `<button data-k="${k}" class="${k === risk ? 'on' : ''}">${v.label}</button>`).join('')}</div>
        <div class="hint" id="riskhint"></div></div>
      <div class="field"><label>6-digit PIN</label><input class="input mono" id="pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>
      <div class="field"><label>Confirm PIN</label><input class="input mono" id="pin2" type="password" inputmode="numeric" maxlength="6" placeholder="••••••"></div>
      <div class="card row between"><div class="row">${icon('fp')}<div><div class="title">Fingerprint unlock</div><div class="sub">${bio.ok ? 'Available on this device' : bio.simulated ? 'Simulated in browser preview' : 'Not available — PIN will be used'}</div></div></div>
        <label class="toggle"><input type="checkbox" id="bio" ${bio.ok || bio.simulated ? 'checked' : 'disabled'}><span></span></label></div>
      <button class="btn" id="create" style="margin-top:8px">Create profile</button>
    </div>`;
    const hint = () => { const p = RISK_PRESETS[risk]; $('#riskhint').textContent = `${p.riskPct}% risk per trade · max ${p.maxPositions} positions · stop at -${p.dailyLossPct}% per day`; };
    hint();
    $$('#risk button').forEach(b => b.onclick = () => { risk = b.dataset.k; $$('#risk button').forEach(x => x.classList.toggle('on', x === b)); hint(); });
    $$('.cpick').forEach(b => b.onclick = () => { color = b.dataset.c; $$('.cpick').forEach(x => x.style.outline = x === b ? '3px solid var(--text)' : ''); });
    $('#create').onclick = async () => {
      const name = $('#name').value.trim(), pin = $('#pin').value, pin2 = $('#pin2').value;
      if (!name) return toast('Please enter your name');
      if (!/^\d{6}$/.test(pin)) return toast('PIN must be 6 digits');
      if (pin !== pin2) return toast('PINs do not match');
      if ($('#bio').checked && bio.ok && !(await Security.verify('Confirm fingerprint to enable unlock'))) return toast('Fingerprint not confirmed');
      S.profile = { name, email: $('#email').value.trim(), pinHash: await Security.hashPin(pin), biometric: $('#bio').checked, riskProfile: risk, color, created: Date.now() };
      Object.assign(S.bot, RISK_PRESETS[risk], { profile: risk });
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
    $$('.nav button').forEach(b => b.onclick = () => goTab(b.dataset.tab));
    renderView();
  }
  /* ---------- Navigation + Android back button ----------
     Back closes the top dialog/sheet → otherwise jumps straight to Home → on Home, press twice to exit. */
  const navStack = [];
  const TAB_ORDER = ['home', 'markets', 'bot', 'portfolio', 'profile'];
  function goTab(tab, fromBack = false, dir = 0, noAnim = false) {
    if (!$('#view') || tab === S.tab) return;
    if (!dir) dir = Math.sign(TAB_ORDER.indexOf(tab) - TAB_ORDER.indexOf(S.tab));
    if (!fromBack) { navStack.push(S.tab); if (navStack.length > 30) navStack.shift(); }
    if (S.tab === 'bot') S.settingsUnlocked = false;   // settings re-lock when you leave Auto-Trade
    S.tab = tab;
    $$('.nav button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    $('#view').dataset.view = ''; renderView(); window.scrollTo(0, 0); document.body.scrollTop = 0;
    const scr = $('#view .screen'); if (scr && !noAnim) scr.classList.add(dir > 0 ? 'enter-right' : 'enter-left');
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
    function makePeek(dir) {
      dropPeek();
      const tab = neighbour(dir); if (!tab) return;
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
    function animate(x, ms, done) {
      const tr = `transform ${ms}ms cubic-bezier(.25,.8,.3,1)`;
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
        const ms = Math.round(Math.max(80, Math.min(180, remain / Math.max(Math.abs(vx), 2.2))));
        settling = true;
        animate(to, ms, () => {
          goTab(target, false, peekDir, true);                          // same content the peek showed, so it swaps invisibly
          dropPeek(); S._dragging = false; settling = false;
        });
      } else {
        settling = true;
        animate(0, 160, () => { cur.style.transition = ''; cur.style.transform = ''; cur.style.willChange = ''; dropPeek(); S._dragging = false; settling = false; });
      }
    };
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
  })();
  let lastBack = 0;
  function handleBack() {
    const dlg = $$('.dlg-bg').at(-1); if (dlg && dlg._cancel) { dlg._cancel(); return; }
    const sheets = $$('.sheet-bg:not(.closing)'); if (sheets.length) { closeSheet(sheets.at(-1)); return; }
    if (S.unlocked && $('#view') && S.tab !== 'home') return goTab('home', true, -1);
    if (Date.now() - lastBack < 2000) { const A = window.Capacitor?.Plugins?.App; return A ? A.exitApp() : undefined; }
    lastBack = Date.now(); toast('Press back again to exit');
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
      ${liveTradesHtml()}
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
    return `<div class="tcard ${cls(p.profit)}" data-key="t${p.id}">
      <div class="row between"><div class="row" style="gap:8px"><span class="side ${buy ? 'up' : 'down'}">${buy ? 'BUY' : 'SELL'}</span><b>${p.symbol}</b></div><span class="sub">${bot ? st.icon + ' ' + st.label : '✋ Manual'}</span></div>
      <div class="tpl mono ${cls(p.profit)}">${signed(p.profit)}</div>
      <div class="sub mono">${fmt(p.volume)} lot · ${px(p.symbol, p.openPrice)} → ${px(p.symbol, p.currentPrice)}</div>
      ${bar}
      <div class="row between" style="margin-top:10px"><span class="sub">⏱ ${age(p.time)}</span><button class="tclose" data-close="${p.id}">Close</button></div>
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
      ${a ? (() => { const d = Engine.decide(a, S.bot.strategy, S.mood, S.bot); return `<div class="card row between" style="background:var(--card2);margin-bottom:10px"><div><div class="sub">${Engine.REGIME_LABEL[a.regime]} market · ${S.bot.strategy === 'auto' ? 'Auto picks' : 'Strategy'}</div><div class="title">${Engine.STRATEGIES[d.strategy].icon} ${Engine.STRATEGIES[d.strategy].label} <span class="sub">${esc(d.why)}</span></div></div><span class="chip ${d.action === 'BUY' ? 'up' : d.action === 'SELL' ? 'down' : 'neutral'}">${d.action}</span></div>`; })() : ''}
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
      <h3>Strategy radar</h3><div class="card" id="radar" data-view="radar">${radarHtml()}</div>
      <div class="lockbar ${S.settingsUnlocked ? 'open' : ''}" id="lockbar"><div><b id="lockt">${S.settingsUnlocked ? '🔓 Editing settings' : '🔒 Settings locked'}</b><div class="sub" id="locks">${S.settingsUnlocked ? 'Lock again when you are done' : 'Prevents accidental changes while scrolling'}</div></div><button class="btn small ${S.settingsUnlocked ? '' : 'ghost'}" id="lockbtn">${S.settingsUnlocked ? 'Lock' : 'Unlock to edit'}</button></div>
      <div id="botsettings" class="${S.settingsUnlocked ? '' : 'locked'}">
      <h3>Strategy</h3><div class="strat-grid" id="strat">${Object.entries(Engine.STRATEGIES).map(([k, st]) => `<button data-st="${k}" class="strat ${b.strategy === k ? 'on' : ''}"><span class="em">${st.icon}</span><b>${st.label}</b><small>${st.desc}</small></button>`).join('')}</div>
      <h3>Risk profile</h3><div class="seg" id="preset">${Object.entries(RISK_PRESETS).map(([k, p]) => `<button data-k="${k}" class="${b.profile === k ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <h3>Symbols</h3><div class="tabs-mini" style="flex-wrap:wrap" id="syms">${[...new Set([...b.symbols, ...all])].slice(0, 40).map(s => `<button data-s="${s}" class="${b.symbols.includes(s) ? 'on' : ''}">${s}</button>`).join('')}</div>
      <h3>Strategy settings</h3><div class="card">
        <div class="field"><label>Timeframe</label><div class="seg" id="tf">${['5m', '15m', '1h', '4h'].map(t => `<button data-t="${t}" class="${b.timeframe === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        ${slider('threshold', 'Entry sentiment threshold', 15, 80, 1, '±')}
        ${slider('minConfidence', 'Minimum confidence', 20, 90, 1, '', '%')}
        ${slider('slAtr', 'Stop-loss (× ATR)', .5, 5, .1)}
        ${slider('tpAtr', 'Take-profit (× ATR)', .5, 8, .1)}
        <div class="row between"><div><div class="title">Exit when sentiment flips</div><div class="sub">Close bot positions on an opposite signal</div></div><label class="toggle"><input type="checkbox" id="flip" ${b.exitOnFlip ? 'checked' : ''}><span></span></label></div>
      </div>
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
        ${slider('intervalSec', 'Scan interval', 5, 300, 5, '', ' s')}
      </div>
      </div>
      <h3>Activity log</h3><div class="card log" id="botlog">${logHtml()}</div>
      <button class="btn ghost" id="clearlog">Clear log</button>
    </div>`;
    bindTop();
    $('#bottoggle').onchange = e => toggleBot(e.target.checked);
    $$('#strat button').forEach(x => x.onclick = () => { b.strategy = x.dataset.st; save(); $$('#strat button').forEach(y => y.classList.toggle('on', y === x)); paint($('#radar'), radarHtml(), 'radar'); log(`Strategy set to ${Engine.STRATEGIES[b.strategy].label}`); });
    bindPositions(v);
    $$('#preset button').forEach(x => x.onclick = () => { Object.assign(S.bot, RISK_PRESETS[x.dataset.k], { profile: x.dataset.k }); save(); viewBot(v); toast(`${RISK_PRESETS[x.dataset.k].label} profile applied`); });
    $$('#syms button').forEach(x => x.onclick = () => { const s = x.dataset.s; b.symbols = b.symbols.includes(s) ? b.symbols.filter(y => y !== s) : [...b.symbols, s]; x.classList.toggle('on'); save(); });
    $$('#tf button').forEach(x => x.onclick = () => { b.timeframe = x.dataset.t; $$('#tf button').forEach(y => y.classList.toggle('on', y === x)); save(); });
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
  const slider = (k, l, min, max, step, pre = '', suf = '') => `<div class="field"><div class="row between"><label style="margin:0 0 4px 4px">${l}</label><b class="mono" id="v_${k}">${pre}${S.bot[k]}${suf}</b></div>
    <input type="range" data-k="${k}" data-pre="${pre}" data-suf="${suf}" min="${min}" max="${max}" step="${step}" value="${S.bot[k]}"></div>`;
  const targetHint = () => `Each trade closes at about <b class="up">+$${fmt(S.bot.tpUsd)}</b> or <b class="down">−$${fmt(S.bot.slUsd)}</b>. The bot picks the lot size so the target sits about ${S.bot.tpAtr}× ATR away (set under Strategy), within Max lot. Spread and commission are not included.`;
  function radarHtml() {
    return watch().map(sym => { const a = S.analysis[sym]; const d = Engine.decide(a, S.bot.strategy, S.mood, S.bot);
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
    S.bot.enabled = on; S.bot.pausedReason = ''; save(); log(on ? `Bot started (${RISK_PRESETS[S.bot.profile]?.label || 'Custom'} profile)` : 'Bot stopped', on ? 'up' : '');
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
      <h3>Allocation</h3><div class="card">${Object.keys(exp).length ? `<div class="row">${donut(exp)}<div class="donut-legend grow">${Object.entries(exp).map(([s, vol], k) => `<div><i style="background:${pal(k)}"></i>${s}<span class="grow"></span><b class="mono">${fmt(vol)} lot</b></div>`).join('')}</div></div>` : '<div class="empty">No open exposure</div>'}</div>
      ${posHeader('Open positions · ' + S.positions.length)}<div class="card">${positionsHtml(S.positions)}</div>
      <h3>Closed trades</h3><div class="card">${h.slice(0, 30).map(d => `<div class="list-item" data-key="d${d.id}-${d.time}"><div class="avatar ${d.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${d.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
        <div class="grow"><div class="title">${d.symbol} <span class="sub">${fmt(d.volume)} lot</span></div><div class="sub">${new Date(d.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${closeWhy(d)}</div></div>
        <div class="mono title ${cls(d.profit)}">${signed(d.profit)}</div></div>`).join('') || '<div class="empty">No closed trades yet</div>'}</div>
    </div>`, 'portfolio');
    bindTop(); bindPositions(v);
    const pts = []; let run = (a.balance ?? 0) - realized; pts.push(run); h.slice().reverse().forEach(d => pts.push(run += d.profit)); pts.push(a.equity ?? run);
    if (!S.privacy) drawLine($('#eq'), pts);
  }
  /* Who/what closed a trade: paper keeps an explicit reason; MT5 deals carry it in the close comment. */
  function closeWhy(d) {
    let r = d.reason || '';
    const c = d.comment || '';
    if (!r) r = /\[sl/i.test(c) ? 'SL' : /\[tp/i.test(c) ? 'TP' : /\[so/i.test(c) ? 'Stop out' : /^TBX /.test(c) ? c.slice(4) : c ? 'Closed in MT5' : '';
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
    return list.map(p => `<div class="list-item" data-key="p${p.id}"><div class="avatar ${p.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
      <div class="grow"><div class="title">${p.symbol} <span class="sub">${fmt(p.volume)} lot${isBot(p) ? ' · 🤖' : ''}</span></div><div class="sub mono">${px(p.symbol, p.openPrice)} → ${px(p.symbol, p.currentPrice)}</div></div>
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
        <span class="chip" style="margin-top:6px">${RISK_PRESETS[p.riskProfile]?.label || 'Custom'} investor</span></div></div>
      <h3>Trading account</h3><div class="card"><div class="row between"><div class="row"><div class="avatar">${S.conn.mode === 'bridge' ? 'VPS' : isLive() ? 'MT5' : 'SIM'}</div>
        <div><div class="title"><span id="pacct">${esc(acctTitle())}</span></div><div class="sub">${isLive() ? esc(S.conn.server || 'MT5') + ' · ' + (S.conn.mode === 'bridge' ? 'Own VPS' : 'MetaApi') + ' · ' + S.status : 'Simulated market · $10,000 start'}</div></div></div>
        <button class="btn small" id="conn">${isLive() ? 'Manage' : 'Connect MT5'}</button></div></div>
      <h3>Appearance</h3><div class="card">
        <div class="seg" id="tmode3"><button data-a="system" class="${S.theme === 'system' ? 'on' : ''}">System</button><button data-a="light" class="${S.theme === 'light' ? 'on' : ''}">Light</button><button data-a="dark" class="${S.theme !== 'system' && S.theme !== 'light' ? 'on' : ''}">Dark</button></div>
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
      <h3>News sentiment (optional)</h3><div class="card"><div class="field"><label>Alpha Vantage API key</label><input class="input mono" id="nkey" value="${esc(S.newsKey)}" placeholder="Free key from alphavantage.co"></div>
        <div class="hint">Adds a news-sentiment factor (20% weight) for FX pairs. Cached hourly to fit the free quota.</div><button class="btn ghost" id="nsave" style="margin-top:10px">Save key</button></div>
      <h3>Data</h3><div class="card">${S.conn.mode === 'demo' ? '<button class="btn ghost" id="reset" style="margin-bottom:10px">Reset paper account</button>' : ''}<button class="btn danger" id="wipe">Sign out & erase app data</button></div>
      <p class="hint" style="text-align:center;margin-top:16px">Tradebot v1.0 · Not financial advice. Trading leveraged products carries a high risk of loss.</p>
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
    let risk = p.riskProfile;
    $$('#prisk button').forEach(b => b.onclick = () => { risk = b.dataset.k; $$('#prisk button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#psave').onclick = () => { const n = $('#pname').value.trim(); if (!n) return toast('Name required'); Object.assign(p, { name: n, email: $('#pemail').value.trim(), riskProfile: risk }); Object.assign(S.bot, RISK_PRESETS[risk], { profile: risk }); save(); toast('Profile saved'); viewProfile(v); };
    $('#pbio').onchange = async e => { if (e.target.checked && !(await Security.verify('Enable fingerprint unlock'))) { e.target.checked = false; return; } p.biometric = e.target.checked; save(); toast(p.biometric ? 'Fingerprint enabled' : 'Fingerprint disabled'); };
    $('#ppin').onclick = changePin;
    $('#phide').onchange = e => { S.prefs.hideByDefault = e.target.checked; save(); toast(e.target.checked ? 'Amounts will be hidden each time the app opens' : 'Amounts shown when the app opens'); };
    $('#pnow').onchange = e => setPrivacy(e.target.checked, true);
    $$('#cconf button').forEach(b => b.onclick = () => { S.prefs.confirmClose = b.dataset.c; save(); $$('#cconf button').forEach(x => x.classList.toggle('on', x === b)); toast(b.dataset.c === 'off' ? 'Close confirmation off' : b.dataset.c === 'loss' ? 'Confirm closing losing trades' : 'Confirm closing every trade'); });
    $('#plock').onclick = () => { S.unlocked = false; render(); };
    $('#nsave').onclick = () => { S.newsKey = $('#nkey').value.trim(); store.set('newsKey', S.newsKey); toast(S.newsKey ? 'News sentiment enabled' : 'News sentiment off'); };
    const r = $('#reset'); if (r) r.onclick = async () => { if (await ask({ title: 'Reset paper account?', message: 'Balance goes back to $10,000 and paper positions and history are cleared.', ok: 'Reset', tone: 'danger', ic: 'wallet' })) { S.broker.reset(); log('Paper account reset'); poll(); toast('Paper account reset'); } };
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
  async function drawChart(c, sym) {
    if (!c || !S.broker) return;
    let candles = S.candleCache[sym]; if (!candles) return;
    candles = candles.slice(-70);
    const [x, w, h] = setupCanvas(c); const pad = { l: 4, r: 54, t: 8, b: 16 };
    const hi = Math.max(...candles.map(k => k.high)), lo = Math.min(...candles.map(k => k.low)), rng = hi - lo || 1;
    const Y = v => pad.t + (hi - v) / rng * (h - pad.t - pad.b), cw = (w - pad.l - pad.r) / candles.length;
    x.strokeStyle = css('--line'); x.fillStyle = css('--muted'); x.font = '10px system-ui'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = lo + rng * i / 4, y = Y(v); x.beginPath(); x.moveTo(pad.l, y); x.lineTo(w - pad.r, y); x.stroke(); x.fillText(px(sym, v), w - pad.r + 4, y + 3); }
    const closesAll = S.candleCache[sym].map(k => k.close), off = closesAll.length - candles.length;
    [[Engine.ema(closesAll, 20), css('--accent')], [Engine.ema(closesAll, 50), css('--warn')]].forEach(([e, col]) => { x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); candles.forEach((_, i) => { const X = pad.l + i * cw + cw / 2, y = Y(e[off + i]); i ? x.lineTo(X, y) : x.moveTo(X, y); }); x.stroke(); });
    candles.forEach((k, i) => { const up = k.close >= k.open, col = up ? css('--up') : css('--down'), X = pad.l + i * cw + cw / 2; x.strokeStyle = x.fillStyle = col; x.lineWidth = 1; x.beginPath(); x.moveTo(X, Y(k.high)); x.lineTo(X, Y(k.low)); x.stroke(); const bh = Math.max(1, Math.abs(Y(k.open) - Y(k.close))); x.fillRect(X - cw * .35, Math.min(Y(k.open), Y(k.close)), cw * .7, bh); });
    const last = candles.at(-1).close, ly = Y(last); x.setLineDash([3, 3]); x.strokeStyle = css('--accent'); x.beginPath(); x.moveTo(pad.l, ly); x.lineTo(w - pad.r, ly); x.stroke(); x.setLineDash([]);
    x.fillStyle = css('--accent'); x.fillRect(w - pad.r + 1, ly - 8, pad.r - 1, 16); x.fillStyle = '#fff'; x.font = 'bold 10px system-ui'; x.fillText(px(sym, last), w - pad.r + 4, ly + 3);
    x.fillStyle = css('--muted'); x.font = '10px system-ui'; x.fillText('EMA20', pad.l + 2, h - 3); x.fillStyle = css('--warn'); x.fillText('EMA50', pad.l + 44, h - 3);
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
    S.broker?.destroy?.(); S.status = 'Connecting';
    if (S.conn.mode === 'bridge') {
      S.broker = new Brokers.BridgeBroker({ url: S.conn.url, token: await Security.getSecret('bridge') });
      try {
        const info = await S.broker.connect(onStatus); S.status = 'Connected';
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
    S.pollMs = isLive() ? 5000 : 2000;
    if (pollT) { clearInterval(pollT); pollT = setInterval(poll, S.pollMs); }
    S.candleCache = {}; await poll(); await analyseAll(); scheduleBot(true);
  }
  async function poll() {
    if (!S.broker) return;
    ringBusy(true);
    try {
      [S.account, S.positions] = await Promise.all([S.broker.getAccount(), S.broker.getPositions()]);
      if (!S._histT || Date.now() - S._histT > (isLive() ? 60000 : 0)) { S.history = await S.broker.getHistory(); S._histT = Date.now(); }
      const today = new Date().toDateString();
      if (!S.dayStart || S.dayStart.day !== today) { S.dayStart = { day: today, equity: S.account.equity }; store.set('dayStart', S.dayStart); }
      if (isLive()) S.status = 'Connected';
      checkBasket();
    } catch (e) { S.status = 'Error'; }
    refreshLive(); ringBusy(false); ringCycle();
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

  async function analyseAll() {
    if (!S.broker) return;
    const syms = [...new Set([...watch(), ...(S.tab === 'markets' ? (S.marketVisible || []).slice(0, 30) : [])])];
    await Promise.all(syms.map(async s => {
      try {
        const c = await S.broker.getCandles(s, S.bot.timeframe, 200); S.candleCache[s] = c;
        if (S.conn.mode !== 'demo' && !(s in (S.digitsOf ||= {}))) { try { S.digitsOf[s] = (await S.broker.getSpec(s)).digits; } catch { } }
        const news = await Brokers.News.forSymbol(s, S.newsKey);
        S.analysis[s] = Engine.analyse(c, { threshold: S.bot.threshold, news });
      } catch (e) { /* symbol unavailable */ }
    }));
    S.mood = Engine.marketMood(watch().map(s => S.analysis[s]));
    refreshLive();
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
      // Exits: trend/breakout/sentiment trades close when sentiment turns against them;
      // reversion trades take profit once price returns to the middle Bollinger band.
      for (const p of mine) {
        const a = S.analysis[p.symbol]; if (!a) continue;
        const buy = p.type === 'POSITION_TYPE_BUY', st = stratOf(p);
        let why = '';
        if (st === 'reversion') { if (buy ? a.bb.pctB >= .5 : a.bb.pctB <= .5) why = 'Back to mean'; }
        else if (S.bot.exitOnFlip && (buy ? a.score <= -S.bot.threshold * .6 : a.score >= S.bot.threshold * .6)) why = `Sentiment flipped (${a.score})`;
        if (why) { try { await S.broker.closePosition(p.id, st === 'reversion' ? 'Bot: back to mean' : 'Bot: sentiment flip'); log(`${why} on ${p.symbol}: closed ${signed(p.profit)}`, cls(p.profit)); } catch (e) { log(`Close ${p.symbol} failed: ${e.message}`, 'down'); } }
      }
      // Entries
      await poll();
      let open = S.positions.filter(p => isBot(p)).length;
      const cands = watch().map(s => [s, S.analysis[s], Engine.decide(S.analysis[s], S.bot.strategy, S.mood, S.bot)]).filter(([, , d]) => d.action !== 'HOLD')
        .sort((x, y) => Math.abs(y[1].score) * y[2].riskMult - Math.abs(x[1].score) * x[2].riskMult);
      for (const [s, a, d] of cands) {
        if (open >= S.bot.maxPositions) break;
        if (S.positions.some(p => p.symbol === s)) continue;
        const spec = await S.broker.getSpec(s);
        const vol = S.bot.targetMode === 'usd' ? usdPlan(s, a, spec, d.tpAtr).lot : lotFor(s, a, spec, d.slAtr, d.riskMult);
        const st = Engine.STRATEGIES[d.strategy];
        try { await placeOrder(s, d.action, vol, `TB ${STRAT_CODE[d.strategy]}${a.score > 0 ? '+' : ''}${a.score}`, { slAtr: d.slAtr, tpAtr: d.tpAtr, tag: st.icon + ' ' + st.label + ':' }); open++; notify(`Tradebot ${d.action} ${s}`, `${st.label} · ${vol} lot · ${d.why}`); }
        catch (e) { log(`Order ${s} failed: ${e.message}`, 'down'); }
      }
      await poll();
    } catch (e) { log('Bot error: ' + e.message, 'down'); }
    finally { botBusy = false; }
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
    S.pollMs = isLive() ? 5000 : 2000;
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

  applyTheme(); applyHero();
  render();
  window.Tradebot = S; // debugging
})();
