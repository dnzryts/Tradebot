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
  const DEFAULT_BOT = { enabled: false, symbols: ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD'], timeframe: '15m', maxLot: 1, exitOnFlip: true, intervalSec: 10, ...RISK_PRESETS.balanced, profile: 'balanced' };
  const THEMES = { midnight: ['#0b0f1a', '#6c8cff', '#9b6cff'], aurora: ['#04131a', '#19e3c3', '#4f9dff'], gold: ['#0e0c08', '#f2c14e', '#f08a4b'], light: ['#f3f5fb', '#4f6bff', '#8b5cf6'] };
  const AVATAR_COLORS = ['#6c8cff', '#19e3c3', '#f2c14e', '#ff5c7a', '#9b6cff', '#22d3a0'];

  const S = {
    profile: store.get('profile'),               // {name, email, pinHash, biometric, riskProfile, color, created}
    theme: store.get('theme') || 'midnight',
    onboarded: store.get('onboarded') || false,
    conn: store.get('conn') || { mode: 'demo' },  // {mode:'demo'|'mt5', accountId, region, login, server}
    bot: { ...DEFAULT_BOT, ...(store.get('bot') || {}) },
    newsKey: store.get('newsKey') || '',
    log: store.get('log') || [],
    tab: 'home', broker: null, account: null, positions: [], history: [], analysis: {}, mood: null,
    pollMs: 0, focus: 'EURUSD', unlocked: false, status: 'Offline', dayStart: store.get('dayStart'),
  };
  if (S.bot.enabled && S.conn.mode === 'mt5') S.bot.enabled = false; // never auto-resume live trading after restart

  /* ---------------- Helpers ---------------- */
  const fmt = (v, d = 2) => (v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, c = S.account?.currency || 'USD') => (v < 0 ? '-' : '') + (c === 'USD' ? '$' : c + ' ') + fmt(Math.abs(v));
  const signed = v => (v >= 0 ? '+' : '-') + money(Math.abs(v)).replace('-', '');
  const digits = sym => Brokers.SPECS[sym]?.digits ?? (sym.includes('JPY') ? 3 : 5);
  const px = (sym, v) => fmt(v, digits(sym));
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const sentCls = s => s >= 25 ? 'up' : s <= -25 ? 'down' : 'neutral';
  const save = () => { store.set('bot', S.bot); store.set('conn', S.conn); store.set('profile', S.profile); store.set('theme', S.theme); };
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function log(msg, kind = '') { S.log.unshift({ t: Date.now(), msg, kind }); S.log = S.log.slice(0, 200); store.set('log', S.log); const el = $('#botlog'); if (el) el.innerHTML = logHtml(); }
  function setTheme(t) { S.theme = t; document.documentElement.dataset.theme = t; document.querySelector('meta[name=theme-color]').content = THEMES[t][0]; save(); }

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
      for (const at of [...x.attributes]) if (!y.hasAttribute(at.name) && !(at.name === 'class' && /flash-/.test(at.value))) x.removeAttribute(at.name);
      for (const at of [...y.attributes]) {
        if (at.name === 'class') { const fl = [...x.classList].filter(c => c.startsWith('flash-')); const want = at.value + (fl.length ? ' ' + fl.join(' ') : ''); if (x.getAttribute('class') !== want) x.setAttribute('class', want); }
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
    const unlock = () => { S.unlocked = true; render(); boot(); };
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
    $$('.nav button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; $$('.nav button').forEach(x => x.classList.toggle('on', x === b)); $('#view').dataset.view = ''; renderView(); window.scrollTo(0, 0); if (S.tab === 'markets') analyseAll(); });
    renderView();
  }
  function renderView() {
    const v = $('#view'); if (!v) return;
    ({ home: viewHome, markets: viewMarkets, bot: viewBot, portfolio: viewPortfolio, profile: viewProfile })[S.tab](v);
  }
  /* Live refresh: only the screens without form inputs re-render fully. */
  function refreshLive() {
    if (!S.unlocked || !$('#view')) return;
    if (['home', 'markets', 'portfolio'].includes(S.tab)) renderView();
    if (S.tab === 'bot') { const st = $('#botstat'); if (st) { paint(st, botStatusHtml(), 'bot'); const t = $('#bottoggle'); t.checked = S.bot.enabled; t.onchange = e => toggleBot(e.target.checked); } }
    const sh = $('#symsheet'); if (sh) symbolSheetUpdate();
  }

  const topbar = (title) => `<div class="topbar"><div><div class="hello">${greeting()}, ${esc(S.profile.name)}</div><h2>${title}</h2></div>
    <div class="row" style="gap:8px"><button class="ring" id="ring" data-keep title="Live data · tap to refresh now">${ringSvg}</button>
    <button class="icon-btn" id="connbtn" title="Account">${S.conn.mode === 'mt5' ? `<span class="dot ${S.status === 'Connected' ? 'live' : ''}"></span>` : icon('link')}</button></div></div>`;
  const ringSvg = '<svg viewBox="0 0 36 36"><circle class="track" cx="18" cy="18" r="15"/><circle class="prog" cx="18" cy="18" r="15"/></svg><i></i>';
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const bindTop = () => {
    const b = $('#connbtn'); if (b) b.onclick = openConnect;
    const r = $('#ring'); if (r && !r.onclick) { r.onclick = () => { poll(); analyseAll(); }; ringCycle(); }
  };
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
      <div class="card hero">
        <div class="row between"><span class="muted">Equity · ${esc(a.name || '—')}</span><span class="chip" style="background:rgba(255,255,255,.2)">${S.conn.mode === 'mt5' ? 'LIVE MT5' : 'PAPER'}</span></div>
        <div class="big mono" style="margin:6px 0 12px">${money(a.equity ?? 0)}</div>
        <div class="grid3"><div class="stat"><div class="lbl">Balance</div><div class="val mono">${money(a.balance ?? 0)}</div></div>
          <div class="stat"><div class="lbl">Floating</div><div class="val mono">${signed(pl)}</div></div>
          <div class="stat"><div class="lbl">Free margin</div><div class="val mono">${money(a.freeMargin ?? 0)}</div></div></div>
      </div>
      <div class="card"><div class="row between"><h2 style="font-size:17px">Market sentiment</h2><span class="chip ${sentCls(mood.score)}">${mood.label}</span></div>
        <div class="gauge-wrap">${gauge(mood.score)}<div class="grow">
          <div class="sub">Bullish symbols</div><div class="title up" style="font-size:20px">${mood.bulls}</div>
          <div class="sub" style="margin-top:6px">Bearish symbols</div><div class="title down" style="font-size:20px">${mood.bears}</div>
          <div class="sub" style="margin-top:6px">Bot: <b class="${S.bot.enabled ? 'up' : ''}">${S.bot.enabled ? 'Running' : 'Paused'}</b></div></div></div></div>
      <div class="card"><div class="row between" style="margin-bottom:10px"><div><h2 style="font-size:17px">${S.focus}</h2><div class="sub mono">${focus ? px(S.focus, focus.price) : '—'} · ${S.bot.timeframe}</div></div>
        ${focus ? `<span class="chip ${sentCls(focus.score)}">${focus.score > 0 ? '+' : ''}${focus.score} ${focus.label}</span>` : ''}</div>
        <div class="tabs-mini" id="focus">${watch().map(s => `<button class="${s === S.focus ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
        <div class="chart-box" style="margin-top:10px"><canvas id="chart" height="230"></canvas></div></div>
      <h3>Open positions</h3><div class="card">${positionsHtml(S.positions.slice(0, 4))}</div>
      <h3>Bot activity</h3><div class="card log">${S.log.slice(0, 5).map(logRow).join('') || '<div class="empty">No activity yet</div>'}</div>
    </div>`, 'home');
    bindTop();
    $$('#focus button').forEach(b => b.onclick = () => { S.focus = b.dataset.s; renderView(); });
    bindPositions(v);
    drawChart($('#chart'), S.focus);
  }
  const watch = () => S.bot.symbols.length ? S.bot.symbols : ['EURUSD'];

  function gauge(score) {
    const ang = (score / 100) * 90; const col = score >= 25 ? 'var(--up)' : score <= -25 ? 'var(--down)' : 'var(--warn)';
    return `<svg class="gauge" viewBox="0 0 140 86"><defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="var(--warn)"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>
      <path d="M14 76 A56 56 0 0 1 126 76" stroke="url(#gg)" stroke-width="12" fill="none" stroke-linecap="round" opacity=".9"/>
      <g style="transform:rotate(${ang}deg);transform-origin:70px 76px;transition:transform .8s cubic-bezier(.2,.8,.2,1)"><line x1="70" y1="76" x2="70" y2="30" stroke="${col}" stroke-width="4" stroke-linecap="round"/></g>
      <circle cx="70" cy="76" r="7" fill="${col}"/><text x="70" y="62" text-anchor="middle" font-size="17" font-weight="800">${score > 0 ? '+' : ''}${score}</text></svg>`;
  }

  /* ---------- Markets ---------- */
  function viewMarkets(v) {
    const syms = S.allSymbols || watch();
    paint(v, `<div class="screen">${topbar('Markets')}
      <div class="card"><div class="sub">Sentiment combines trend (EMA 20/50), RSI momentum, MACD, rate of change, candle flow, mean-reversion${S.newsKey ? ' and live news' : ''}. Tap a symbol for details and manual trades.</div></div>
      <div class="card">${syms.map(s => { const a = S.analysis[s]; return `<div class="list-item" data-sym="${s}" data-key="${s}" style="cursor:pointer">
        <div class="avatar">${s.slice(0, 3)}</div><div class="grow"><div class="title">${s}</div><div class="sub">${a ? `RSI ${fmt(a.rsi, 0)} · conf ${a.confidence}%` : 'Analysing…'}</div></div>
        <div class="right"><div class="mono title">${a ? px(s, a.price) : '—'}</div>${a ? `<span class="chip ${sentCls(a.score)}">${a.score > 0 ? '▲' : a.score < 0 ? '▼' : '•'} ${a.label}</span>` : ''}</div></div>`; }).join('')}</div>
    </div>`, 'markets');
    bindTop();
    $$('[data-sym]').forEach(r => r.onclick = () => openSymbol(r.dataset.sym));
  }

  function openSymbol(sym) {
    S.focus = sym;
    const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'symsheet';
    bg.innerHTML = `<div class="sheet"><div class="grip"></div><div id="symbody"></div></div>`;
    bg.onclick = e => { if (e.target === bg) bg.remove(); };
    document.body.appendChild(bg); symbolSheetUpdate(true);
  }
  function symbolSheetUpdate(first) {
    const sym = S.focus, a = S.analysis[sym], body = $('#symbody'); if (!body) return;
    const lot = $('#lot')?.value || '0.10';
    paint(body, `<div class="row between"><div><h2>${sym}</h2><div class="sub mono">${a ? px(sym, a.price) : '—'} · ATR ${a ? px(sym, a.atr) : '—'}</div></div>
      ${a ? `<span class="chip ${sentCls(a.score)}">${a.score > 0 ? '+' : ''}${a.score} · ${a.label}</span>` : ''}</div>
      <div class="chart-box" style="margin:12px 0"><canvas id="symchart" height="230"></canvas></div>
      ${a ? `<div class="grid3" style="margin-bottom:10px"><div class="stat"><div class="lbl">Signal</div><div class="val ${a.signal === 'BUY' ? 'up' : a.signal === 'SELL' ? 'down' : ''}">${a.signal}</div></div>
        <div class="stat"><div class="lbl">Confidence</div><div class="val">${a.confidence}%</div></div><div class="stat"><div class="lbl">RSI</div><div class="val">${fmt(a.rsi, 1)}</div></div></div>
        <div class="card" style="background:var(--card2)">${a.factors.map(f => `<div class="factor"><span class="muted">${f.key}</span><div class="bar"><i style="left:${f.v < 0 ? 50 + f.v / 2 : 50}%;width:${Math.abs(f.v) / 2}%;background:${f.v >= 0 ? 'var(--up)' : 'var(--down)'}"></i><i style="left:50%;width:1px;background:var(--muted)"></i></div><span class="mono right ${cls(f.v)}">${f.v > 0 ? '+' : ''}${f.v}</span></div>`).join('')}</div>` : '<div class="empty">Analysing…</div>'}
      <div class="field"><label>Lot size</label><input class="input mono" id="lot" type="number" step="0.01" min="0.01" value="${lot}"></div>
      <div class="grid2"><button class="btn" style="background:var(--up)" data-side="BUY">Buy</button><button class="btn danger" data-side="SELL">Sell</button></div>
      <p class="hint">Stop-loss / take-profit are set from ATR × ${S.bot.slAtr} / ${S.bot.tpAtr} (Auto-Trade settings).</p>`, 'sym:' + sym);
    $$('[data-side]', body).forEach(b => b.onclick = () => manualTrade(sym, b.dataset.side, +$('#lot').value));
    drawChart($('#symchart'), sym);
  }
  async function manualTrade(sym, side, volume) {
    if (!(volume > 0)) return toast('Enter a lot size');
    if (S.conn.mode === 'mt5' && !confirm(`Place a LIVE ${side} ${volume} ${sym} order on your MT5 account?`)) return;
    try { await placeOrder(sym, side, volume, 'TB manual'); toast(`${side} ${volume} ${sym} placed`); $('#symsheet')?.remove(); poll(); }
    catch (e) { toast('Order failed: ' + e.message); }
  }

  /* ---------- Auto-trade ---------- */
  function viewBot(v) {
    const b = S.bot, all = S.allSymbols || Object.keys(Brokers.SPECS);
    v.innerHTML = `<div class="screen">${topbar('Auto-Trade')}
      <div class="card" id="botstat" data-view="bot">${botStatusHtml()}</div>
      ${S.conn.mode === 'mt5' ? '<div class="notice" style="margin-bottom:12px"><b>Live account.</b> The bot places real orders with real money. Automated strategies can and do lose. Start small and watch it closely.</div>' : ''}
      <h3>Risk profile</h3><div class="seg" id="preset">${Object.entries(RISK_PRESETS).map(([k, p]) => `<button data-k="${k}" class="${b.profile === k ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <h3>Symbols</h3><div class="tabs-mini" style="flex-wrap:wrap" id="syms">${all.slice(0, 40).map(s => `<button data-s="${s}" class="${b.symbols.includes(s) ? 'on' : ''}">${s}</button>`).join('')}</div>
      <h3>Strategy</h3><div class="card">
        <div class="field"><label>Timeframe</label><div class="seg" id="tf">${['5m', '15m', '1h', '4h'].map(t => `<button data-t="${t}" class="${b.timeframe === t ? 'on' : ''}">${t}</button>`).join('')}</div></div>
        ${slider('threshold', 'Entry sentiment threshold', 15, 80, 1, '±')}
        ${slider('minConfidence', 'Minimum confidence', 20, 90, 1, '', '%')}
        ${slider('slAtr', 'Stop-loss (× ATR)', .5, 5, .1)}
        ${slider('tpAtr', 'Take-profit (× ATR)', .5, 8, .1)}
        <div class="row between"><div><div class="title">Exit when sentiment flips</div><div class="sub">Close bot positions on an opposite signal</div></div><label class="toggle"><input type="checkbox" id="flip" ${b.exitOnFlip ? 'checked' : ''}><span></span></label></div>
      </div>
      <h3>Money management</h3><div class="card">
        ${slider('riskPct', 'Risk per trade', .1, 5, .1, '', '% of equity')}
        ${slider('maxPositions', 'Max open positions', 1, 10, 1)}
        ${slider('dailyLossPct', 'Daily loss limit (bot pauses)', .5, 20, .5, '-', '%')}
        ${slider('maxLot', 'Max lot per trade', .01, 10, .01)}
        ${slider('intervalSec', 'Scan interval', 5, 300, 5, '', ' s')}
      </div>
      <h3>Activity log</h3><div class="card log" id="botlog">${logHtml()}</div>
      <button class="btn ghost" id="clearlog">Clear log</button>
    </div>`;
    bindTop();
    $('#bottoggle').onchange = e => toggleBot(e.target.checked);
    $$('#preset button').forEach(x => x.onclick = () => { Object.assign(S.bot, RISK_PRESETS[x.dataset.k], { profile: x.dataset.k }); save(); viewBot(v); toast(`${RISK_PRESETS[x.dataset.k].label} profile applied`); });
    $$('#syms button').forEach(x => x.onclick = () => { const s = x.dataset.s; b.symbols = b.symbols.includes(s) ? b.symbols.filter(y => y !== s) : [...b.symbols, s]; x.classList.toggle('on'); save(); });
    $$('#tf button').forEach(x => x.onclick = () => { b.timeframe = x.dataset.t; $$('#tf button').forEach(y => y.classList.toggle('on', y === x)); save(); });
    $$('input[data-k]').forEach(inp => inp.oninput = () => { b[inp.dataset.k] = +inp.value; b.profile = 'custom'; $$('#preset button').forEach(y => y.classList.remove('on')); $(`#v_${inp.dataset.k}`).textContent = inp.dataset.pre + inp.value + inp.dataset.suf; save(); });
    $('#flip').onchange = e => { b.exitOnFlip = e.target.checked; save(); };
    $('#clearlog').onclick = () => { S.log = []; store.set('log', []); $('#botlog').innerHTML = logHtml(); };
  }
  const slider = (k, l, min, max, step, pre = '', suf = '') => `<div class="field"><div class="row between"><label style="margin:0 0 4px 4px">${l}</label><b class="mono" id="v_${k}">${pre}${S.bot[k]}${suf}</b></div>
    <input type="range" data-k="${k}" data-pre="${pre}" data-suf="${suf}" min="${min}" max="${max}" step="${step}" value="${S.bot[k]}"></div>`;
  function botStatusHtml() {
    const b = S.bot, botPos = S.positions.filter(p => (p.comment || '').startsWith('TB')).length;
    return `<div class="row between"><div class="row"><div class="avatar" style="background:var(--grad);color:#fff">${icon('bot')}</div><div><div class="title">Sentiment Bot</div>
      <div class="sub"><span class="dot ${b.enabled ? 'live' : ''}"></span> ${b.enabled ? 'Running' : b.pausedReason || 'Paused'} · ${S.conn.mode === 'mt5' ? 'Live MT5' : 'Paper'}</div></div></div>
      <label class="toggle"><input type="checkbox" id="bottoggle" ${b.enabled ? 'checked' : ''}><span></span></label></div>
      <div class="grid3" style="margin-top:12px"><div class="stat"><div class="lbl">Watching</div><div class="val">${b.symbols.length}</div></div>
      <div class="stat"><div class="lbl">Bot trades</div><div class="val">${botPos}/${b.maxPositions}</div></div><div class="stat"><div class="lbl">Today</div><div class="val mono ${cls(todayPnl())}">${signed(todayPnl())}</div></div></div>`;
  }
  async function toggleBot(on) {
    if (on && !S.bot.symbols.length) { toast('Pick at least one symbol'); $('#bottoggle').checked = false; return; }
    if (on && S.conn.mode === 'mt5') {
      const ok = confirm('Enable auto-trading on your LIVE MT5 account?\n\nThe bot will open and close real positions using your risk settings. You are responsible for all losses.');
      if (!ok || (S.profile.biometric && !(await Security.verify('Confirm to enable live auto-trading')))) { $('#bottoggle').checked = false; return; }
    }
    S.bot.enabled = on; S.bot.pausedReason = ''; save(); log(on ? `Bot started (${RISK_PRESETS[S.bot.profile]?.label || 'Custom'} profile)` : 'Bot stopped', on ? 'up' : '');
    const st = $('#botstat'); if (st) { paint(st, botStatusHtml(), 'bot'); const t = $('#bottoggle'); t.checked = S.bot.enabled; t.onchange = e => toggleBot(e.target.checked); }
    scheduleBot(true);
  }
  const logRow = l => `<div><time>${time(l.t)}</time><span class="${l.kind}">${esc(l.msg)}</span></div>`;
  const logHtml = () => S.log.map(logRow).join('') || '<div class="empty">No activity yet</div>';

  /* ---------- Portfolio ---------- */
  function viewPortfolio(v) {
    const a = S.account || {}, h = S.history;
    const wins = h.filter(d => d.profit > 0), realized = h.reduce((s, d) => s + d.profit, 0);
    const exp = {}; S.positions.forEach(p => exp[p.symbol] = (exp[p.symbol] || 0) + Math.abs(p.volume));
    paint(v, `<div class="screen">${topbar('Portfolio')}
      <div class="card"><div class="row between"><div><div class="sub">Realised P/L (${S.conn.mode === 'mt5' ? '30 days' : 'all time'})</div><div class="big mono ${cls(realized)}" style="font-size:28px">${signed(realized)}</div></div>
        <div class="right"><div class="sub">Win rate</div><div class="title" style="font-size:20px">${h.length ? fmt(wins.length / h.length * 100, 0) : 0}%</div></div></div>
        ${h.length ? '<div class="chart-box" style="height:120px;margin-top:8px"><canvas id="eq" height="120"></canvas></div>' : '<div class="sub" style="margin:10px 0">Equity curve appears after your first closed trade.</div>'}
        <div class="grid3"><div class="stat"><div class="lbl">Trades</div><div class="val">${h.length}</div></div><div class="stat"><div class="lbl">Avg win</div><div class="val mono up">${money(wins.length ? wins.reduce((s, d) => s + d.profit, 0) / wins.length : 0)}</div></div>
        <div class="stat"><div class="lbl">Avg loss</div><div class="val mono down">${money(h.length - wins.length ? h.filter(d => d.profit <= 0).reduce((s, d) => s + d.profit, 0) / (h.length - wins.length) : 0)}</div></div></div></div>
      <h3>Allocation</h3><div class="card">${Object.keys(exp).length ? `<div class="row">${donut(exp)}<div class="donut-legend grow">${Object.entries(exp).map(([s, vol], k) => `<div><i style="background:${pal(k)}"></i>${s}<span class="grow"></span><b class="mono">${fmt(vol)} lot</b></div>`).join('')}</div></div>` : '<div class="empty">No open exposure</div>'}</div>
      <h3>Open positions · ${S.positions.length}</h3><div class="card">${positionsHtml(S.positions)}</div>
      <h3>Closed trades</h3><div class="card">${h.slice(0, 30).map(d => `<div class="list-item" data-key="d${d.id}-${d.time}"><div class="avatar ${d.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${d.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
        <div class="grow"><div class="title">${d.symbol} <span class="sub">${fmt(d.volume)} lot</span></div><div class="sub">${new Date(d.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${d.reason ? ' · ' + d.reason : ''}</div></div>
        <div class="mono title ${cls(d.profit)}">${signed(d.profit)}</div></div>`).join('') || '<div class="empty">No closed trades yet</div>'}</div>
    </div>`, 'portfolio');
    bindTop(); bindPositions(v);
    const pts = []; let run = (a.balance ?? 0) - realized; pts.push(run); h.slice().reverse().forEach(d => pts.push(run += d.profit)); pts.push(a.equity ?? run);
    drawLine($('#eq'), pts);
  }
  const pal = k => ['var(--accent)', 'var(--up)', 'var(--warn)', 'var(--accent2)', 'var(--down)', '#5ac8fa', '#ff9f0a'][k % 7];
  function donut(exp) {
    const tot = Object.values(exp).reduce((a, b) => a + b, 0); let acc = 0; const C = 2 * Math.PI * 40;
    return `<svg viewBox="0 0 100 100" style="width:120px;flex:none;transform:rotate(-90deg)">${Object.values(exp).map((v, k) => { const len = v / tot * C; const s = `<circle cx="50" cy="50" r="40" fill="none" stroke="${pal(k)}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"/>`; acc += len; return s; }).join('')}</svg>`;
  }
  function positionsHtml(list) {
    if (!list.length) return '<div class="empty">No open positions</div>';
    return list.map(p => `<div class="list-item" data-key="p${p.id}"><div class="avatar ${p.type === 'POSITION_TYPE_BUY' ? 'up' : 'down'}">${p.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL'}</div>
      <div class="grow"><div class="title">${p.symbol} <span class="sub">${fmt(p.volume)} lot${(p.comment || '').startsWith('TB') ? ' · 🤖' : ''}</span></div><div class="sub mono">${px(p.symbol, p.openPrice)} → ${px(p.symbol, p.currentPrice)}</div></div>
      <div class="right"><div class="mono title ${cls(p.profit)}">${signed(p.profit)}</div><button class="sub" data-close="${p.id}" style="color:var(--accent);font-weight:700">Close</button></div></div>`).join('');
  }
  function bindPositions(root) {
    $$('[data-close]', root).forEach(b => b.onclick = async () => {
      if (S.conn.mode === 'mt5' && !confirm('Close this live position?')) return;
      try { await S.broker.closePosition(b.dataset.close); toast('Position closed'); log(`Closed position #${b.dataset.close} manually`); poll(); } catch (e) { toast('Close failed: ' + e.message); }
    });
  }

  /* ---------- Profile ---------- */
  function viewProfile(v) {
    const p = S.profile;
    v.innerHTML = `<div class="screen">${topbar('Profile')}
      <div class="card row"><div class="avatar" style="background:${p.color};color:#fff;width:58px;height:58px;border-radius:20px;font-size:22px">${esc(p.name[0]).toUpperCase()}</div>
        <div class="grow"><div class="title" style="font-size:18px">${esc(p.name)}</div><div class="sub">${esc(p.email || 'No email')} · since ${new Date(p.created).toLocaleDateString()}</div>
        <span class="chip" style="margin-top:6px">${RISK_PRESETS[p.riskProfile]?.label || 'Custom'} investor</span></div></div>
      <h3>Trading account</h3><div class="card"><div class="row between"><div class="row"><div class="avatar">${S.conn.mode === 'mt5' ? 'MT5' : 'SIM'}</div>
        <div><div class="title">${S.conn.mode === 'mt5' ? `MT5 · ${esc(S.conn.login || S.conn.accountId?.slice(0, 8))}` : 'Paper trading'}</div><div class="sub">${S.conn.mode === 'mt5' ? esc(S.conn.server || 'MetaApi') + ' · ' + S.status : 'Simulated market · $10,000 start'}</div></div></div>
        <button class="btn small" id="conn">${S.conn.mode === 'mt5' ? 'Manage' : 'Connect MT5'}</button></div></div>
      <h3>Theme</h3><div class="swatches">${Object.entries(THEMES).map(([k, c]) => `<button class="swatch ${S.theme === k ? 'on' : ''}" data-t="${k}"><i style="background:linear-gradient(135deg,${c[0]} 0 40%,${c[1]} 40% 70%,${c[2]} 70%)"></i>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <h3>Edit profile</h3><div class="card">
        <div class="field"><label>Display name</label><input class="input" id="pname" value="${esc(p.name)}" maxlength="24"></div>
        <div class="field"><label>Email</label><input class="input" id="pemail" value="${esc(p.email)}"></div>
        <div class="field"><label>Investor risk profile</label><div class="seg" id="prisk">${Object.entries(RISK_PRESETS).map(([k, r]) => `<button data-k="${k}" class="${p.riskProfile === k ? 'on' : ''}">${r.label}</button>`).join('')}</div></div>
        <button class="btn" id="psave">Save profile</button></div>
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
    $$('.swatch').forEach(b => b.onclick = () => { setTheme(b.dataset.t); $$('.swatch').forEach(x => x.classList.toggle('on', x === b)); });
    let risk = p.riskProfile;
    $$('#prisk button').forEach(b => b.onclick = () => { risk = b.dataset.k; $$('#prisk button').forEach(x => x.classList.toggle('on', x === b)); });
    $('#psave').onclick = () => { const n = $('#pname').value.trim(); if (!n) return toast('Name required'); Object.assign(p, { name: n, email: $('#pemail').value.trim(), riskProfile: risk }); Object.assign(S.bot, RISK_PRESETS[risk], { profile: risk }); save(); toast('Profile saved'); viewProfile(v); };
    $('#pbio').onchange = async e => { if (e.target.checked && !(await Security.verify('Enable fingerprint unlock'))) { e.target.checked = false; return; } p.biometric = e.target.checked; save(); toast(p.biometric ? 'Fingerprint enabled' : 'Fingerprint disabled'); };
    $('#ppin').onclick = changePin;
    $('#plock').onclick = () => { S.unlocked = false; render(); };
    $('#nsave').onclick = () => { S.newsKey = $('#nkey').value.trim(); store.set('newsKey', S.newsKey); toast(S.newsKey ? 'News sentiment enabled' : 'News sentiment off'); };
    const r = $('#reset'); if (r) r.onclick = () => { if (confirm('Reset paper account to $10,000?')) { S.broker.reset(); log('Paper account reset'); poll(); toast('Paper account reset'); } };
    $('#wipe').onclick = async () => { if (!confirm('Erase profile, settings and stored credentials from this device?')) return; await Security.deleteSecret('metaapi'); Object.keys(localStorage).filter(k => k.startsWith('tb')).forEach(k => localStorage.removeItem(k)); location.reload(); };
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
  function sheet(html, bind) { const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.innerHTML = `<div class="sheet"><div class="grip"></div>${html}</div>`; bg.onclick = e => { if (e.target === bg) bg.remove(); }; document.body.appendChild(bg); bind && bind(bg); return bg; }

  /* ---------- Connect MT5 ---------- */
  function openConnect() {
    let method = 'new';
    sheet(`<h2>Configure MT5 account</h2><p class="sub">Tradebot reaches MetaTrader 5 through <b>MetaApi</b> (metaapi.cloud), a cloud bridge to your broker's MT5 server. Create a free MetaApi account and an API token first.</p>
      <div class="seg" id="cmode" style="margin:12px 0"><button data-m="demo" class="${S.conn.mode === 'demo' ? 'on' : ''}">Paper (simulated)</button><button data-m="mt5" class="${S.conn.mode === 'mt5' ? 'on' : ''}">MT5 via MetaApi</button></div>
      <div id="mt5form" class="${S.conn.mode === 'mt5' ? '' : 'hidden'}">
        <div class="field"><label>MetaApi API token</label><input class="input mono" id="tok" type="password" placeholder="${S.conn.mode === 'mt5' ? 'Saved securely — leave blank to keep' : 'Paste token'}"></div>
        <div class="seg" id="cmeth" style="margin-bottom:12px"><button data-m="new" class="on">Add MT5 login</button><button data-m="id">Existing MetaApi account ID</button></div>
        <div id="fnew"><div class="field"><label>MT5 login</label><input class="input mono" id="lg" inputmode="numeric" value="${esc(S.conn.login || '')}"></div>
          <div class="field"><label>MT5 password (trading)</label><input class="input" id="pw" type="password"><div class="hint">Sent once to MetaApi to register the account; never stored on this phone.</div></div>
          <div class="field"><label>Broker server</label><input class="input" id="sv" placeholder="e.g. ICMarketsSC-Demo" value="${esc(S.conn.server || '')}"></div></div>
        <div id="fid" class="hidden"><div class="field"><label>MetaApi account ID</label><input class="input mono" id="aid" value="${esc(S.conn.accountId || '')}"></div></div>
        <div class="notice" style="margin-bottom:12px">Use a <b>demo MT5 account</b> first. Live trading carries real financial risk.</div>
      </div>
      <div class="sub" id="cstat" style="margin-bottom:10px"></div>
      <button class="btn" id="cgo">Save & connect</button>`, el => {
      $$('#cmode button', el).forEach(b => b.onclick = () => { $$('#cmode button', el).forEach(x => x.classList.toggle('on', x === b)); $('#mt5form', el).classList.toggle('hidden', b.dataset.m !== 'mt5'); });
      $$('#cmeth button', el).forEach(b => b.onclick = () => { method = b.dataset.m; $$('#cmeth button', el).forEach(x => x.classList.toggle('on', x === b)); $('#fnew', el).classList.toggle('hidden', method !== 'new'); $('#fid', el).classList.toggle('hidden', method !== 'id'); });
      $('#cgo', el).onclick = async () => {
        const mode = $('#cmode .on', el).dataset.m, st = $('#cstat', el), btn = $('#cgo', el);
        if (mode === 'demo') { S.bot.enabled = false; S.conn = { mode: 'demo' }; save(); el.remove(); await connectBroker(); toast('Switched to paper trading'); return; }
        const token = $('#tok', el).value.trim() || await Security.getSecret('metaapi');
        if (!token) return toast('MetaApi token required');
        btn.disabled = true;
        try {
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
          el.remove(); toast('MT5 account connected');
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
  S.candleCache = {};
  async function connectBroker(onStatus) {
    S.broker?.destroy?.(); S.status = 'Connecting';
    if (S.conn.mode === 'mt5') {
      const token = await Security.getSecret('metaapi');
      S.broker = new Brokers.MetaApiBroker({ token, accountId: S.conn.accountId, region: S.conn.region });
      try { await S.broker.connect(onStatus); S.conn.region = S.broker.region; save(); S.status = 'Connected'; log('Connected to MT5 account', 'up'); }
      catch (e) { S.status = 'Error'; log('MT5 connection failed: ' + e.message, 'down'); throw e; }
      try { const syms = await S.broker.getSymbols(); S.allSymbols = Array.isArray(syms) ? syms.slice(0, 200) : null; } catch { }
    } else {
      S.broker = new Brokers.DemoBroker(store); S.allSymbols = Object.keys(Brokers.SPECS); S.status = 'Connected';
      S.broker.onEvent = ev => { if (ev.type === 'closed' && ev.deal.reason !== 'Manual') log(`${ev.deal.reason} hit on ${ev.deal.symbol}: ${signed(ev.deal.profit)}`, cls(ev.deal.profit)); };
    }
    S.pollMs = S.conn.mode === 'mt5' ? 5000 : 2000;
    if (pollT) { clearInterval(pollT); pollT = setInterval(poll, S.pollMs); }
    S.candleCache = {}; await poll(); await analyseAll(); scheduleBot(true);
  }
  async function poll() {
    if (!S.broker) return;
    ringBusy(true);
    try {
      [S.account, S.positions] = await Promise.all([S.broker.getAccount(), S.broker.getPositions()]);
      if (!S._histT || Date.now() - S._histT > (S.conn.mode === 'mt5' ? 60000 : 0)) { S.history = await S.broker.getHistory(); S._histT = Date.now(); }
      const today = new Date().toDateString();
      if (!S.dayStart || S.dayStart.day !== today) { S.dayStart = { day: today, equity: S.account.equity }; store.set('dayStart', S.dayStart); }
      if (S.conn.mode === 'mt5') S.status = 'Connected';
    } catch (e) { S.status = 'Error'; }
    refreshLive(); ringBusy(false); ringCycle();
  }
  const todayPnl = () => S.account && S.dayStart ? S.account.equity - S.dayStart.equity : 0;

  async function analyseAll() {
    if (!S.broker) return;
    const syms = [...new Set([...watch(), ...(S.tab === 'markets' ? (S.allSymbols || []).slice(0, 12) : [])])];
    await Promise.all(syms.map(async s => {
      try {
        const c = await S.broker.getCandles(s, S.bot.timeframe, 200); S.candleCache[s] = c;
        const news = await Brokers.News.forSymbol(s, S.newsKey);
        S.analysis[s] = Engine.analyse(c, { threshold: S.bot.threshold, news });
      } catch (e) { /* symbol unavailable */ }
    }));
    S.mood = Engine.marketMood(watch().map(s => S.analysis[s]));
    refreshLive();
  }

  function lotFor(sym, a, spec) {
    const eq = S.account.equity, risk = eq * S.bot.riskPct / 100, slDist = a.atr * S.bot.slAtr;
    let perLot = slDist * spec.contractSize; if (/^USD/.test(sym) && !/USD$/.test(sym)) perLot /= a.price; // quote not USD (e.g. USDJPY)
    let vol = risk / (perLot || 1e9);
    const step = spec.volumeStep || .01; vol = Math.floor(vol / step) * step;
    return +Math.min(Math.max(vol, spec.minVolume || .01), spec.maxVolume || 100, S.bot.maxLot).toFixed(2);
  }
  async function placeOrder(sym, side, volume, comment) {
    const a = S.analysis[sym], spec = await S.broker.getSpec(sym), q = await S.broker.getPrice(sym);
    const entry = side === 'BUY' ? q.ask : q.bid, d = spec.digits ?? digits(sym), r = v => +v.toFixed(d);
    const atr = a?.atr || 0;
    const sl = atr ? r(side === 'BUY' ? entry - atr * S.bot.slAtr : entry + atr * S.bot.slAtr) : undefined;
    const tp = atr ? r(side === 'BUY' ? entry + atr * S.bot.tpAtr : entry - atr * S.bot.tpAtr) : undefined;
    const res = await S.broker.trade({ symbol: sym, side, volume, stopLoss: sl, takeProfit: tp, comment });
    log(`${side} ${volume} ${sym} @ ${px(sym, entry)} · SL ${sl ? px(sym, sl) : '—'} TP ${tp ? px(sym, tp) : '—'}`, side === 'BUY' ? 'up' : 'down');
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
      const mine = S.positions.filter(p => (p.comment || '').startsWith('TB'));
      // Exits on sentiment flip
      if (S.bot.exitOnFlip) for (const p of mine) {
        const a = S.analysis[p.symbol]; if (!a) continue;
        if ((p.type === 'POSITION_TYPE_BUY' && a.signal === 'SELL') || (p.type === 'POSITION_TYPE_SELL' && a.signal === 'BUY')) {
          await S.broker.closePosition(p.id); log(`Sentiment flipped on ${p.symbol} (${a.score}) — closed ${signed(p.profit)}`, cls(p.profit));
        }
      }
      // Entries
      await poll();
      let open = S.positions.filter(p => (p.comment || '').startsWith('TB')).length;
      const cands = watch().map(s => [s, S.analysis[s]]).filter(([, a]) => a && a.signal !== 'HOLD' && a.confidence >= S.bot.minConfidence)
        .sort((x, y) => Math.abs(y[1].score) - Math.abs(x[1].score));
      for (const [s, a] of cands) {
        if (open >= S.bot.maxPositions) break;
        if (S.positions.some(p => p.symbol === s)) continue;
        const vol = lotFor(s, a, await S.broker.getSpec(s));
        try { await placeOrder(s, a.signal, vol, `TB ${a.score}`); open++; notify(`Tradebot ${a.signal} ${s}`, `${vol} lot · sentiment ${a.score} (${a.label})`); }
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
    const iv = Math.max(S.conn.mode === 'mt5' ? 30 : 5, S.bot.intervalSec) * 1000;
    if (S.bot.enabled) { botT = setInterval(botCycle, iv); if (restart) botCycle(); }
  }
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    S.pollMs = S.conn.mode === 'mt5' ? 5000 : 2000;
    try { await connectBroker(); } catch (e) { toast('Account offline: ' + e.message); }
    pollT = setInterval(poll, S.pollMs);
    anaT = setInterval(() => !S.bot.enabled && analyseAll(), S.conn.mode === 'mt5' ? 60000 : 6000);
    try { window.Capacitor?.Plugins?.LocalNotifications?.requestPermissions(); } catch { }
  }
  // Re-lock when app goes to background for > 60s
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (S.profile && S.unlocked && Date.now() - hiddenAt > 60000 && hiddenAt) { S.unlocked = false; render(); }
  });

  setTheme(S.theme);
  render();
  window.Tradebot = S; // debugging
})();
