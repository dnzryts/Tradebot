/* Tradebot brokers.
   - DemoBroker: offline paper-trading simulator (default, no real money).
   - MetaApiBroker: real MT5 account via MetaApi cloud REST API (https://metaapi.cloud).
   Both expose the same async interface used by the app and the auto-trader. */
(function (global) {
  /* Paper-trading universe. q = quote (profit) currency; vol ≈ typical 15-minute move. */
  const SPECS = {
    // Forex majors
    EURUSD: { base: 1.0820, vol: .00055, digits: 5, contract: 100000, q: 'USD', cat: 'Forex', desc: 'Euro vs US Dollar' },
    GBPUSD: { base: 1.2710, vol: .00065, digits: 5, contract: 100000, q: 'USD', cat: 'Forex', desc: 'Pound vs US Dollar' },
    USDJPY: { base: 151.20, vol: .085, digits: 3, contract: 100000, q: 'JPY', cat: 'Forex', desc: 'US Dollar vs Yen' },
    AUDUSD: { base: 0.6560, vol: .00045, digits: 5, contract: 100000, q: 'USD', cat: 'Forex', desc: 'Australian Dollar vs US Dollar' },
    USDCHF: { base: 0.8850, vol: .0005, digits: 5, contract: 100000, q: 'CHF', cat: 'Forex', desc: 'US Dollar vs Swiss Franc' },
    USDCAD: { base: 1.3950, vol: .0006, digits: 5, contract: 100000, q: 'CAD', cat: 'Forex', desc: 'US Dollar vs Canadian Dollar' },
    NZDUSD: { base: 0.5880, vol: .0004, digits: 5, contract: 100000, q: 'USD', cat: 'Forex', desc: 'NZ Dollar vs US Dollar' },
    // Forex crosses
    EURGBP: { base: 0.8510, vol: .0003, digits: 5, contract: 100000, q: 'GBP', cat: 'Forex', desc: 'Euro vs Pound' },
    EURJPY: { base: 163.50, vol: .10, digits: 3, contract: 100000, q: 'JPY', cat: 'Forex', desc: 'Euro vs Yen' },
    GBPJPY: { base: 192.40, vol: .14, digits: 3, contract: 100000, q: 'JPY', cat: 'Forex', desc: 'Pound vs Yen' },
    AUDJPY: { base: 99.20, vol: .08, digits: 3, contract: 100000, q: 'JPY', cat: 'Forex', desc: 'Australian Dollar vs Yen' },
    EURAUD: { base: 1.6490, vol: .0009, digits: 5, contract: 100000, q: 'AUD', cat: 'Forex', desc: 'Euro vs Australian Dollar' },
    EURCHF: { base: 0.9420, vol: .0004, digits: 5, contract: 100000, q: 'CHF', cat: 'Forex', desc: 'Euro vs Swiss Franc' },
    CADJPY: { base: 108.40, vol: .07, digits: 3, contract: 100000, q: 'JPY', cat: 'Forex', desc: 'Canadian Dollar vs Yen' },
    // Metals
    XAUUSD: { base: 2640.0, vol: 2.4, digits: 2, contract: 100, q: 'USD', cat: 'Metals', desc: 'Gold' },
    XAGUSD: { base: 31.20, vol: .06, digits: 3, contract: 5000, q: 'USD', cat: 'Metals', desc: 'Silver' },
    XPTUSD: { base: 955.0, vol: 2.2, digits: 2, contract: 50, q: 'USD', cat: 'Metals', desc: 'Platinum' },
    // Energy
    USOIL: { base: 69.80, vol: .12, digits: 2, contract: 1000, q: 'USD', cat: 'Energy', desc: 'WTI Crude Oil' },
    UKOIL: { base: 73.40, vol: .12, digits: 2, contract: 1000, q: 'USD', cat: 'Energy', desc: 'Brent Crude Oil' },
    NGAS: { base: 3.150, vol: .012, digits: 3, contract: 10000, q: 'USD', cat: 'Energy', desc: 'Natural Gas' },
    // Indices
    US30: { base: 44200, vol: 38, digits: 1, contract: 1, q: 'USD', cat: 'Indices', desc: 'Dow Jones 30' },
    US500: { base: 5980, vol: 5.5, digits: 1, contract: 1, q: 'USD', cat: 'Indices', desc: 'S&P 500' },
    NAS100: { base: 20850, vol: 22, digits: 1, contract: 1, q: 'USD', cat: 'Indices', desc: 'Nasdaq 100' },
    GER40: { base: 19950, vol: 18, digits: 1, contract: 1, q: 'EUR', cat: 'Indices', desc: 'Germany 40 (DAX)' },
    UK100: { base: 8250, vol: 7, digits: 1, contract: 1, q: 'GBP', cat: 'Indices', desc: 'UK 100 (FTSE)' },
    JP225: { base: 38600, vol: 45, digits: 0, contract: 1, q: 'JPY', cat: 'Indices', desc: 'Japan 225 (Nikkei)' },
    // Crypto
    BTCUSD: { base: 96500, vol: 210, digits: 2, contract: 1, q: 'USD', cat: 'Crypto', desc: 'Bitcoin' },
    ETHUSD: { base: 3450, vol: 14, digits: 2, contract: 1, q: 'USD', cat: 'Crypto', desc: 'Ethereum' },
  };
  // How to turn the quote currency into USD using the live paper prices
  const USD_RATE = { EUR: ['EURUSD', 1], GBP: ['GBPUSD', 1], AUD: ['AUDUSD', 1], NZD: ['NZDUSD', 1], JPY: ['USDJPY', -1], CHF: ['USDCHF', -1], CAD: ['USDCAD', -1] };
  const TF_MS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };

  /* ---------------- Demo / paper broker ---------------- */
  class DemoBroker {
    constructor(store) {
      this.kind = 'demo'; this.store = store;
      const s = store.get('demo') || {};
      this.balance = s.balance ?? 10000; this.positions = s.positions || []; this.deals = s.deals || []; this.nextId = s.nextId || 1001;
      this.series = {}; this.regime = {};
      // Restore the simulated market exactly where the last session left it (fallback: fresh seed).
      const m = store.get('demo_market');
      Object.keys(SPECS).forEach(sym => {
        const rows = m?.v === 1 && m.series?.[sym];
        if (rows && rows.length >= 60) {
          this.series[sym] = rows.map(([time, open, high, low, close, tickVolume]) => ({ time, open, high, low, close, tickVolume }));
          this.regime[sym] = m.regime?.[sym] || { drift: 0, left: 30, ticks: 0 };
        } else this._seed(sym);
      });
      if (!m) this._saveMarket();
      this._onHide = () => this._saveMarket();
      addEventListener('pagehide', this._onHide);
      document.addEventListener('visibilitychange', this._vis = () => { if (document.hidden) this._saveMarket(); });
      this._timer = setInterval(() => this._tick(), 1500);
    }
    _seed(sym) {
      const sp = SPECS[sym]; let p = sp.base; const out = []; let t = Date.now() - 300 * TF_MS['15m'];
      let drift = (Math.random() - .5) * .3;
      for (let i = 0; i < 300; i++) {
        if (i % 40 === 0) drift = (Math.random() - .5) * .5;
        const o = p, c = o + (drift + (Math.random() - .5) * 2) * sp.vol;
        const h = Math.max(o, c) + Math.random() * sp.vol * .8, l = Math.min(o, c) - Math.random() * sp.vol * .8;
        out.push({ time: t, open: o, high: h, low: l, close: c, tickVolume: 200 + Math.random() * 800 | 0 }); p = c; t += TF_MS['15m'];
      }
      this.series[sym] = out; this.regime[sym] = { drift, left: 30 + Math.random() * 40 | 0, ticks: 0 };
    }
    _tick() {
      let newCandle = false;
      Object.keys(SPECS).forEach(sym => {
        const sp = SPECS[sym], s = this.series[sym], rg = this.regime[sym], last = s.at(-1);
        if (--rg.left <= 0) { rg.drift = (Math.random() - .5) * .55; rg.left = 30 + Math.random() * 50 | 0; }
        const c = last.close + (rg.drift * .2 + (Math.random() - .5) * .6) * sp.vol;
        last.close = c; last.high = Math.max(last.high, c); last.low = Math.min(last.low, c); last.tickVolume += Math.random() * 40 | 0;
        if (++rg.ticks >= 12) { // close candle every ~18s (accelerated demo market)
          newCandle = true;
          rg.ticks = 0; s.push({ time: last.time + TF_MS['15m'], open: c, high: c, low: c, close: c, tickVolume: 50 }); if (s.length > 400) s.shift();
        }
      });
      // SL/TP checks: fill at the stop / target level itself (as a broker's stop order would), not at an overshot tick
      this.positions.slice().forEach(p => {
        const px = this._mark(p);
        const isBuy = p.type === 'POSITION_TYPE_BUY';
        const hitSl = p.stopLoss && (isBuy ? px <= p.stopLoss : px >= p.stopLoss);
        const hitTp = p.takeProfit && (isBuy ? px >= p.takeProfit : px <= p.takeProfit);
        if (hitSl) this._close(p, p.stopLoss, 'SL');
        else if (hitTp) this._close(p, p.takeProfit, 'TP');
      });
      this._save();
      if (newCandle) this._saveMarket();
    }
    _spread(sym) { return SPECS[sym].vol * .15; }
    _mark(p) { const mid = this.series[p.symbol].at(-1).close, sp = this._spread(p.symbol) / 2; return p.type === 'POSITION_TYPE_BUY' ? mid - sp : mid + sp; }
    _usdPerQuote(q) {
      if (q === 'USD') return 1;
      const r = USD_RATE[q]; if (!r) return 1;
      const px = this.series[r[0]]?.at(-1).close || SPECS[r[0]].base;
      return r[1] > 0 ? px : 1 / px;
    }
    _pnl(p, px) {
      const sp = SPECS[p.symbol]; const diff = (p.type === 'POSITION_TYPE_BUY' ? px - p.openPrice : p.openPrice - px);
      return diff * p.volume * sp.contract * this._usdPerQuote(sp.q);
    }
    _close(p, px, reason = 'Manual') {
      const profit = this._pnl(p, px); this.balance += profit;
      this.positions = this.positions.filter(x => x.id !== p.id);
      this.deals.unshift({ id: p.id, symbol: p.symbol, type: p.type, volume: p.volume, openPrice: p.openPrice, closePrice: px, profit, time: Date.now(), openTime: p.time, reason, comment: p.comment });
      this.deals = this.deals.slice(0, 300);
      this.onEvent && this.onEvent({ type: 'closed', deal: this.deals[0] });
    }
    /* Persist price history + regime so a new session continues the same market (compact rows). */
    _saveMarket() {
      try {
        const series = {}, f = (v, d) => +v.toFixed(d + 1);
        Object.entries(this.series).forEach(([sym, rows]) => { const d = SPECS[sym].digits; series[sym] = rows.slice(-300).map(c => [c.time, f(c.open, d), f(c.high, d), f(c.low, d), f(c.close, d), c.tickVolume | 0]); });
        this.store.set('demo_market', { v: 1, savedAt: Date.now(), series, regime: this.regime });
      } catch { /* storage full: keep running */ }
    }
    _save() { this.store.set('demo', { balance: this.balance, positions: this.positions, deals: this.deals, nextId: this.nextId }); }
    async connect() { return true; }
    async getAccount() {
      const floating = this.positions.reduce((s, p) => s + this._pnl(p, this._mark(p)), 0);
      const margin = this.positions.reduce((s, p) => s + p.volume * SPECS[p.symbol].contract * p.openPrice * this._usdPerQuote(SPECS[p.symbol].q) / 100, 0);
      return { name: 'Paper Trading', server: 'Tradebot-Demo', currency: 'USD', leverage: 100, balance: this.balance, equity: this.balance + floating, margin, freeMargin: this.balance + floating - margin, platform: 'mt5 (simulated)' };
    }
    async getPositions() { return this.positions.map(p => { const px = this._mark(p); return { ...p, currentPrice: px, profit: this._pnl(p, px) }; }); }
    async getHistory() { return this.deals; }
    async getSymbols() { return Object.keys(SPECS); }
    async getSpec(sym) {
      const s = SPECS[sym], tickSize = Math.pow(10, -s.digits);
      return { symbol: sym, digits: s.digits, contractSize: s.contract, minVolume: .01, maxVolume: 50, volumeStep: .01,
        currencyProfit: s.q, tickSize, tickValue: s.contract * tickSize * this._usdPerQuote(s.q), category: s.cat, description: s.desc };
    }
    async getCatalog() { return Object.entries(SPECS).map(([name, s]) => ({ name, cat: s.cat, desc: s.desc })); }
    async getPrice(sym) { const m = this.series[sym].at(-1).close, sp = this._spread(sym) / 2; return { bid: m - sp, ask: m + sp }; }
    async getCandles(sym, tf = '15m', limit = 200) { return this.series[sym].slice(-limit).map(c => ({ ...c })); }
    async trade({ symbol, side, volume, stopLoss, takeProfit, comment }) {
      const q = await this.getPrice(symbol);
      const p = { id: String(this.nextId++), symbol, type: side === 'BUY' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL', volume: +volume.toFixed(2), openPrice: side === 'BUY' ? q.ask : q.bid, stopLoss, takeProfit, time: Date.now(), comment: comment || '' };
      this.positions.push(p); this._save(); return { stringCode: 'TRADE_RETCODE_DONE', positionId: p.id };
    }
    async closePosition(id, reason = 'Manual') { const p = this.positions.find(x => x.id === id); if (p) { this._close(p, this._mark(p), reason); this._save(); } return { stringCode: 'TRADE_RETCODE_DONE' }; }
    async modifyPosition(id, { stopLoss, takeProfit }) { const p = this.positions.find(x => x.id === id); if (!p) throw new Error('Position not found'); if (stopLoss != null) p.stopLoss = stopLoss; if (takeProfit != null) p.takeProfit = takeProfit; this._save(); return { stringCode: 'TRADE_RETCODE_DONE' }; }
    reset() { this.balance = 10000; this.positions = []; this.deals = []; this._save(); }
    destroy() { this._saveMarket(); clearInterval(this._timer); removeEventListener('pagehide', this._onHide); document.removeEventListener('visibilitychange', this._vis); }
  }

  /* ---------------- MetaApi (real MT5) broker ---------------- */
  const PROV = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
  class MetaApiBroker {
    constructor({ token, accountId, region }) {
      this.kind = 'mt5'; this.token = token; this.accountId = accountId; this.region = region || 'new-york'; this.specCache = {};
    }
    get client() { return `https://mt-client-api-v1.${this.region}.agiliumtrade.ai/users/current/accounts/${this.accountId}`; }
    get market() { return `https://mt-market-data-client-api-v1.${this.region}.agiliumtrade.ai/users/current/accounts/${this.accountId}`; }
    async _req(url, opts = {}) {
      const res = await fetch(url, { ...opts, headers: { 'auth-token': this.token, 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) } });
      const txt = await res.text(); let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { message: txt }; }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    }
    /* Register an MT5 login with MetaApi (password is sent once to MetaApi, never stored on device). */
    static async provision({ token, login, password, server, name }) {
      const res = await fetch(`${PROV}/users/current/accounts`, {
        method: 'POST', headers: { 'auth-token': token, 'Content-Type': 'application/json', 'transaction-id': Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('') },
        body: JSON.stringify({ name: name || `Tradebot ${login}`, login: String(login), password, server, platform: 'mt5', magic: 20261124, type: 'cloud-g2' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Provisioning failed (HTTP ${res.status})`);
      return data.id;
    }
    static async info(token, accountId) {
      const res = await fetch(`${PROV}/users/current/accounts/${accountId}`, { headers: { 'auth-token': token } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      return data; // {state, connectionStatus, region, ...}
    }
    static async deploy(token, accountId) {
      await fetch(`${PROV}/users/current/accounts/${accountId}/deploy`, { method: 'POST', headers: { 'auth-token': token } });
    }
    async connect(onStatus) {
      let info = await MetaApiBroker.info(this.token, this.accountId);
      this.region = info.region || this.region;
      if (info.state === 'UNDEPLOYED') { await MetaApiBroker.deploy(this.token, this.accountId); }
      for (let i = 0; i < 40 && (info.state !== 'DEPLOYED' || info.connectionStatus !== 'CONNECTED'); i++) {
        onStatus && onStatus(`${info.state} · ${info.connectionStatus || '…'}`);
        await new Promise(r => setTimeout(r, 4000));
        info = await MetaApiBroker.info(this.token, this.accountId);
      }
      if (info.connectionStatus !== 'CONNECTED') throw new Error('Account did not connect to broker yet. Check login/server and try again.');
      this.region = info.region || this.region; return true;
    }
    async getAccount() { const a = await this._req(`${this.client}/account-information`); return { ...a, freeMargin: a.freeMargin }; }
    async getPositions() { return (await this._req(`${this.client}/positions`)).map(p => ({ ...p, id: String(p.id) })); }
    async getHistory() {
      const end = new Date(), start = new Date(Date.now() - 30 * 864e5);
      const deals = await this._req(`${this.client}/history-deals/time/${start.toISOString()}/${end.toISOString()}`);
      return (deals || []).filter(d => d.entryType === 'DEAL_ENTRY_OUT').map(d => ({ id: d.positionId, symbol: d.symbol, type: d.type === 'DEAL_TYPE_SELL' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL', volume: d.volume, closePrice: d.price, profit: (d.profit || 0) + (d.commission || 0) + (d.swap || 0), time: new Date(d.time).getTime(), comment: d.comment })).sort((a, b) => b.time - a.time);
    }
    async getSymbols() { return this._req(`${this.client}/symbols`); }
    async getCatalog() { return (await this.getSymbols()).map(name => ({ name })); }
    async getSpec(sym) {
      if (!this.specCache[sym]) this.specCache[sym] = await this._req(`${this.client}/symbols/${encodeURIComponent(sym)}/specification`);
      const s = this.specCache[sym]; return { symbol: sym, digits: s.digits, contractSize: s.contractSize, minVolume: s.minVolume, maxVolume: s.maxVolume, volumeStep: s.volumeStep };
    }
    async getPrice(sym) { return this._req(`${this.client}/symbols/${encodeURIComponent(sym)}/current-price`); }
    async getCandles(sym, tf = '15m', limit = 200) {
      const c = await this._req(`${this.market}/historical-market-data/symbols/${encodeURIComponent(sym)}/timeframes/${tf}/candles?limit=${limit}`);
      return (c || []).map(x => ({ time: new Date(x.time).getTime(), open: x.open, high: x.high, low: x.low, close: x.close, tickVolume: x.tickVolume })).sort((a, b) => a.time - b.time);
    }
    async trade({ symbol, side, volume, stopLoss, takeProfit, comment }) {
      const body = { actionType: side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL', symbol, volume, comment: (comment || 'Tradebot').slice(0, 26) };
      if (stopLoss) body.stopLoss = stopLoss; if (takeProfit) body.takeProfit = takeProfit;
      const r = await this._req(`${this.client}/trade`, { method: 'POST', body: JSON.stringify(body) });
      if (!['TRADE_RETCODE_DONE', 'TRADE_RETCODE_PLACED', 'TRADE_RETCODE_DONE_PARTIAL'].includes(r.stringCode)) throw new Error(r.message || r.stringCode);
      return r;
    }
    async modifyPosition(id, { stopLoss, takeProfit }) { const b = { actionType: 'POSITION_MODIFY', positionId: String(id) }; if (stopLoss != null) b.stopLoss = stopLoss; if (takeProfit != null) b.takeProfit = takeProfit; return this._req(`${this.client}/trade`, { method: 'POST', body: JSON.stringify(b) }); }
    async closePosition(id, reason = 'Manual') { return this._req(`${this.client}/trade`, { method: 'POST', body: JSON.stringify({ actionType: 'POSITION_CLOSE_ID', positionId: String(id), comment: ('TBX ' + reason).slice(0, 26) }) }); }
    destroy() {}
  }

  /* ---------------- Own VPS bridge (MT5 + official MetaTrader5 Python package) ---------------- */
  class BridgeBroker {
    constructor({ url, token }) { this.kind = 'bridge'; this.url = (url || '').replace(/\/+$/, ''); this.token = token; this.specCache = {}; }
    async _req(path, opts = {}, timeoutMs = 20000) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const t = ctl && setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(this.url + path, { ...opts, signal: ctl?.signal, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json' } });
      } catch (e) { throw new Error(e.name === 'AbortError' ? 'Bridge did not respond in time' : `Cannot reach the bridge at ${this.url}`); }
      finally { t && clearTimeout(t); }
      const txt = await res.text(); let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { detail: txt.slice(0, 200) }; }
      if (res.status === 401) throw new Error('Access key rejected by the bridge');
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : (data.message || `Bridge error ${res.status}`));
      return data;
    }
    async connect(onStatus) {
      onStatus && onStatus('Contacting your bridge…');
      const h = await this._req('/health', {}, 12000);
      if (!h.ok) throw new Error('This URL is not a Tradebot bridge');
      onStatus && onStatus('Checking MetaTrader 5…');
      const st = await this._req('/status');
      if (!st.connected) throw new Error('MetaTrader 5 on your VPS is not connected to the broker');
      this.info = st; return st;
    }
    async getAccount() { return this._req('/account'); }
    async getPositions() { return this._req('/positions'); }
    async getHistory() { return this._req('/history?days=30'); }
    async getSymbols() { return this._req('/symbols'); }
    async getCatalog() {
      try { return await this._req('/symbols/catalog'); }                       // bridge ≥ 1.2: names + MT5 paths
      catch { return (await this.getSymbols()).map(name => ({ name })); }          // older bridge: names only
    }
    async getSpec(sym) { return this.specCache[sym] ||= await this._req(`/symbols/${encodeURIComponent(sym)}/spec`); }
    async getPrice(sym) { return this._req(`/symbols/${encodeURIComponent(sym)}/price`); }
    async getCandles(sym, tf = '15m', limit = 200) { return this._req(`/symbols/${encodeURIComponent(sym)}/candles?timeframe=${tf}&limit=${limit}`); }
    async trade({ symbol, side, volume, stopLoss, takeProfit, comment }) {
      return this._req('/trade', { method: 'POST', body: JSON.stringify({ symbol, side, volume, stopLoss: stopLoss ?? null, takeProfit: takeProfit ?? null, comment: comment || '' }) });
    }
    async modifyPosition(id, { stopLoss, takeProfit }) { return this._req(`/positions/${encodeURIComponent(id)}/modify`, { method: 'POST', body: JSON.stringify({ stopLoss: stopLoss ?? null, takeProfit: takeProfit ?? null }) }); }
    async closePosition(id, reason = 'Manual') { return this._req(`/positions/${encodeURIComponent(id)}/close`, { method: 'POST', body: JSON.stringify({ comment: ('TBX ' + reason).slice(0, 31) }) }); }
    destroy() {}
  }

  /* Optional news sentiment via Alpha Vantage NEWS_SENTIMENT (free key, ~25 calls/day → cached 1h). */
  /* Which currencies move a symbol (for news and the economic calendar). */
  const CCY = 'EUR|USD|GBP|JPY|AUD|NZD|CAD|CHF';
  function currenciesOf(sym) {
    const n = String(sym).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = n.match(new RegExp(`^(${CCY})(${CCY})`)); if (m) return [m[1], m[2]];
    if (/^(XAU|XAG|XPT|XPD|GOLD|SILVER|PLATINUM)/.test(n)) return ['USD'];
    if (/(OIL|WTI|BRENT|NGAS|NATGAS|GASOLINE)/.test(n)) return ['USD'];
    if (/^(US30|US500|US100|USTEC|NAS|SPX|SP500|DJ|WS30|US2000)/.test(n)) return ['USD'];
    if (/^(GER|DE40|DAX|FRA40|EU50|STOXX)/.test(n)) return ['EUR'];
    if (/^(UK100|FTSE)/.test(n)) return ['GBP'];
    if (/^(JP225|NIKKEI)/.test(n)) return ['JPY'];
    if (/^AUS200/.test(n)) return ['AUD'];
    if (/^(BTC|ETH|LTC|XRP|SOL)/.test(n)) return ['USD'];
    return [];
  }
  const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('tb_' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('tb_' + k, JSON.stringify(v)); } catch { } } };

  /* Economic calendar: the free weekly ForexFactory feed (no key). Refreshed hourly and kept on the phone. */
  const Calendar = {
    url: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    data: ls.get('calendar', { t: 0, events: [] }), error: '',
    async refresh(force) {
      if (!force && Date.now() - this.data.t < 36e5 && this.data.events.length) return this.data.events;
      try {
        const r = await fetch(this.url); if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json(); if (!Array.isArray(j)) throw new Error('Unexpected calendar format');
        const events = j.map(e => ({ title: e.title, ccy: e.country, time: Date.parse(e.date), impact: e.impact, forecast: e.forecast || '', previous: e.previous || '' })).filter(e => e.time);
        this.data = { t: Date.now(), events }; ls.set('calendar', this.data); this.error = '';
      } catch (e) { this.error = e.message; this.data.t = Date.now() - 30 * 6e4; }   // retry in ~30 min
      return this.data.events;
    },
    /* Upcoming (and just-released) events for the given currencies. */
    upcoming(ccys, { from = Date.now() - 36e5, impacts = ['High', 'Medium'], limit = 50 } = {}) {
      return this.data.events.filter(e => e.time >= from && impacts.includes(e.impact) && (!ccys || ccys.includes(e.ccy))).sort((a, b) => a.time - b.time).slice(0, limit);
    },
    /* A high-impact event for this symbol within [−after, +before] of now → the event, else null. */
    blackout(sym, beforeMin = 30, afterMin = 30) {
      const c = currenciesOf(sym), now = Date.now();
      return this.data.events.find(e => e.impact === 'High' && c.includes(e.ccy) && e.time - beforeMin * 6e4 <= now && now <= e.time + afterMin * 6e4) || null;
    },
  };

  /* News sentiment from Alpha Vantage (optional free key: 25 requests/day).
     One request every 90 min (16/day), rotating through three news topics; articles from the last 24 h are pooled
     and scored per currency, newer and more relevant articles weighing more. Kept on the phone between launches. */
  const News = {
    TOPICS: ['economy_monetary', 'financial_markets', 'economy_macro'],
    st: ls.get('news', { t: 0, i: 0, articles: [], status: '' }),
    async refresh(key, force) {
      if (!key) return;
      if (!force && Date.now() - this.st.t < 90 * 6e4) return;
      const topic = this.TOPICS[this.st.i % this.TOPICS.length];
      this.st.t = Date.now();
      try {
        const r = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${topic}&sort=LATEST&limit=200&apikey=${encodeURIComponent(key)}`);
        const j = await r.json();
        if (!j.feed) { const msg = j.Information || j.Note || j['Error Message'] || 'No news returned'; this.st.status = /limit|frequency|premium/i.test(msg) ? 'Daily request limit reached; retrying later' : msg; this.st.t = Date.now() + 90 * 6e4; ls.set('news', this.st); return; }
        const parseT = s => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
        const fresh = j.feed.map(a => ({ title: a.title, url: a.url, source: a.source, time: parseT(a.time_published || ''), overall: +a.overall_sentiment_score || 0, label: a.overall_sentiment_label || '',
          topics: (a.topics || []).map(t => t.topic), tick: (a.ticker_sentiment || []).filter(t => /^(FOREX|CRYPTO):/.test(t.ticker)).map(t => ({ k: t.ticker, s: +t.ticker_sentiment_score, r: +t.relevance_score })) }));
        const seen = new Set(), cutoff = Date.now() - 864e5;
        this.st.articles = [...fresh, ...this.st.articles].filter(a => a.time > cutoff && !seen.has(a.url) && seen.add(a.url)).slice(0, 400);
        this.st.i++; this.st.status = ''; this.st.ok = Date.now();
      } catch (e) { this.st.status = 'News unavailable: ' + e.message; }
      ls.set('news', this.st);
    },
    /* Weighted sentiment for a ticker like FOREX:USD, −1…1, or undefined when there is no recent coverage. */
    score(ticker) {
      let s = 0, w = 0, n = 0; const now = Date.now();
      this.st.articles.forEach(a => a.tick.forEach(t => { if (t.k === ticker) { const wt = t.r * Math.pow(.5, (now - a.time) / 216e5); s += t.s * wt; w += wt; n++; } }));
      // ±0.35 is Alpha Vantage's "Bullish"/"Bearish" line → ±1; thin coverage is shrunk towards 0 (full weight from 8 articles)
      return n >= 2 && w > 0 ? Math.max(-1, Math.min(1, (s / w) / .35)) * Math.min(1, n / 8) : undefined;
    },
    marketScore() {
      let s = 0, w = 0; const now = Date.now(), l = this.st.articles.filter(a => a.topics.includes('financial_markets'));
      l.forEach(a => { const wt = Math.pow(.5, (now - a.time) / 216e5); s += a.overall * wt; w += wt; });
      return l.length >= 2 && w > 0 ? Math.max(-1, Math.min(1, (s / w) / .35)) * Math.min(1, l.length / 8) : undefined;
    },
    /* Per-symbol news factor: FX = base − quote; gold/silver move against USD; US indices = market tone; crypto = its coin. */
    forSymbol(sym, key) {
      if (!key) return undefined;
      const n = String(sym).toUpperCase().replace(/[^A-Z0-9]/g, ''), c = currenciesOf(sym);
      if (c.length === 2) { const a = this.score('FOREX:' + c[0]), b = this.score('FOREX:' + c[1]); return a == null && b == null ? undefined : Math.max(-1, Math.min(1, ((a || 0) - (b || 0)) / 2)); }
      if (/^(XAU|XAG|GOLD|SILVER)/.test(n)) { const u = this.score('FOREX:USD'); return u == null ? undefined : -u; }
      if (/^(US30|US500|US100|USTEC|NAS|SPX|SP500|DJ|WS30)/.test(n)) return this.marketScore();
      const cr = n.match(/^(BTC|ETH|LTC|XRP|SOL)/); if (cr) return this.score('CRYPTO:' + cr[1]);
      return undefined;
    },
    headlines(sym, limit = 20) {
      const c = sym ? currenciesOf(sym).map(x => 'FOREX:' + x) : null;
      return this.st.articles.filter(a => !c || a.tick.some(t => c.includes(t.k))).sort((a, b) => b.time - a.time).slice(0, limit);
    },
  };

  global.Brokers = { DemoBroker, MetaApiBroker, BridgeBroker, News, Calendar, currenciesOf, SPECS };
})(window);
