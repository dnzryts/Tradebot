/* Tradebot brokers.
   - DemoBroker: offline paper-trading simulator (default, no real money).
   - MetaApiBroker: real MT5 account via MetaApi cloud REST API (https://metaapi.cloud).
   Both expose the same async interface used by the app and the auto-trader. */
(function (global) {
  const SPECS = {
    EURUSD: { base: 1.0820, vol: .00055, digits: 5, contract: 100000, quoteUsd: true },
    GBPUSD: { base: 1.2710, vol: .00065, digits: 5, contract: 100000, quoteUsd: true },
    USDJPY: { base: 151.20, vol: .085, digits: 3, contract: 100000, quoteUsd: false },
    AUDUSD: { base: 0.6560, vol: .00045, digits: 5, contract: 100000, quoteUsd: true },
    XAUUSD: { base: 2640.0, vol: 2.4, digits: 2, contract: 100, quoteUsd: true },
    BTCUSD: { base: 96500, vol: 210, digits: 2, contract: 1, quoteUsd: true },
    US30:   { base: 44200, vol: 38, digits: 1, contract: 1, quoteUsd: true },
  };
  const TF_MS = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };

  /* ---------------- Demo / paper broker ---------------- */
  class DemoBroker {
    constructor(store) {
      this.kind = 'demo'; this.store = store;
      const s = store.get('demo') || {};
      this.balance = s.balance ?? 10000; this.positions = s.positions || []; this.deals = s.deals || []; this.nextId = s.nextId || 1001;
      this.series = {}; this.regime = {};
      Object.keys(SPECS).forEach(sym => this._seed(sym));
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
      Object.keys(SPECS).forEach(sym => {
        const sp = SPECS[sym], s = this.series[sym], rg = this.regime[sym], last = s.at(-1);
        if (--rg.left <= 0) { rg.drift = (Math.random() - .5) * .55; rg.left = 30 + Math.random() * 50 | 0; }
        const c = last.close + (rg.drift * .2 + (Math.random() - .5) * .6) * sp.vol;
        last.close = c; last.high = Math.max(last.high, c); last.low = Math.min(last.low, c); last.tickVolume += Math.random() * 40 | 0;
        if (++rg.ticks >= 12) { // close candle every ~18s (accelerated demo market)
          rg.ticks = 0; s.push({ time: last.time + TF_MS['15m'], open: c, high: c, low: c, close: c, tickVolume: 50 }); if (s.length > 400) s.shift();
        }
      });
      // SL/TP checks
      this.positions.slice().forEach(p => {
        const px = this._mark(p);
        const isBuy = p.type === 'POSITION_TYPE_BUY';
        if ((p.stopLoss && (isBuy ? px <= p.stopLoss : px >= p.stopLoss)) || (p.takeProfit && (isBuy ? px >= p.takeProfit : px <= p.takeProfit)))
          this._close(p, px, p.stopLoss && (isBuy ? px <= p.stopLoss : px >= p.stopLoss) ? 'SL' : 'TP');
      });
      this._save();
    }
    _spread(sym) { return SPECS[sym].vol * .15; }
    _mark(p) { const mid = this.series[p.symbol].at(-1).close, sp = this._spread(p.symbol) / 2; return p.type === 'POSITION_TYPE_BUY' ? mid - sp : mid + sp; }
    _pnl(p, px) {
      const sp = SPECS[p.symbol]; const diff = (p.type === 'POSITION_TYPE_BUY' ? px - p.openPrice : p.openPrice - px);
      let v = diff * p.volume * sp.contract; if (!sp.quoteUsd) v /= px; return v;
    }
    _close(p, px, reason = 'Manual') {
      const profit = this._pnl(p, px); this.balance += profit;
      this.positions = this.positions.filter(x => x.id !== p.id);
      this.deals.unshift({ id: p.id, symbol: p.symbol, type: p.type, volume: p.volume, openPrice: p.openPrice, closePrice: px, profit, time: Date.now(), openTime: p.time, reason, comment: p.comment });
      this.deals = this.deals.slice(0, 300);
      this.onEvent && this.onEvent({ type: 'closed', deal: this.deals[0] });
    }
    _save() { this.store.set('demo', { balance: this.balance, positions: this.positions, deals: this.deals, nextId: this.nextId }); }
    async connect() { return true; }
    async getAccount() {
      const floating = this.positions.reduce((s, p) => s + this._pnl(p, this._mark(p)), 0);
      const margin = this.positions.reduce((s, p) => s + p.volume * SPECS[p.symbol].contract * p.openPrice / (SPECS[p.symbol].quoteUsd ? 1 : p.openPrice) / 100, 0);
      return { name: 'Paper Trading', server: 'Tradebot-Demo', currency: 'USD', leverage: 100, balance: this.balance, equity: this.balance + floating, margin, freeMargin: this.balance + floating - margin, platform: 'mt5 (simulated)' };
    }
    async getPositions() { return this.positions.map(p => { const px = this._mark(p); return { ...p, currentPrice: px, profit: this._pnl(p, px) }; }); }
    async getHistory() { return this.deals; }
    async getSymbols() { return Object.keys(SPECS); }
    async getSpec(sym) { const s = SPECS[sym]; return { symbol: sym, digits: s.digits, contractSize: s.contract, minVolume: .01, maxVolume: 50, volumeStep: .01 }; }
    async getPrice(sym) { const m = this.series[sym].at(-1).close, sp = this._spread(sym) / 2; return { bid: m - sp, ask: m + sp }; }
    async getCandles(sym, tf = '15m', limit = 200) { return this.series[sym].slice(-limit).map(c => ({ ...c })); }
    async trade({ symbol, side, volume, stopLoss, takeProfit, comment }) {
      const q = await this.getPrice(symbol);
      const p = { id: String(this.nextId++), symbol, type: side === 'BUY' ? 'POSITION_TYPE_BUY' : 'POSITION_TYPE_SELL', volume: +volume.toFixed(2), openPrice: side === 'BUY' ? q.ask : q.bid, stopLoss, takeProfit, time: Date.now(), comment: comment || '' };
      this.positions.push(p); this._save(); return { stringCode: 'TRADE_RETCODE_DONE', positionId: p.id };
    }
    async closePosition(id) { const p = this.positions.find(x => x.id === id); if (p) { this._close(p, this._mark(p)); this._save(); } return { stringCode: 'TRADE_RETCODE_DONE' }; }
    reset() { this.balance = 10000; this.positions = []; this.deals = []; this._save(); }
    destroy() { clearInterval(this._timer); }
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
    async closePosition(id) { return this._req(`${this.client}/trade`, { method: 'POST', body: JSON.stringify({ actionType: 'POSITION_CLOSE_ID', positionId: String(id) }) }); }
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
    async getSpec(sym) { return this.specCache[sym] ||= await this._req(`/symbols/${encodeURIComponent(sym)}/spec`); }
    async getPrice(sym) { return this._req(`/symbols/${encodeURIComponent(sym)}/price`); }
    async getCandles(sym, tf = '15m', limit = 200) { return this._req(`/symbols/${encodeURIComponent(sym)}/candles?timeframe=${tf}&limit=${limit}`); }
    async trade({ symbol, side, volume, stopLoss, takeProfit, comment }) {
      return this._req('/trade', { method: 'POST', body: JSON.stringify({ symbol, side, volume, stopLoss: stopLoss ?? null, takeProfit: takeProfit ?? null, comment: comment || '' }) });
    }
    async closePosition(id) { return this._req(`/positions/${encodeURIComponent(id)}/close`, { method: 'POST' }); }
    destroy() {}
  }

  /* Optional news sentiment via Alpha Vantage NEWS_SENTIMENT (free key, ~25 calls/day → cached 1h). */
  const News = {
    cache: {},
    async currency(cur, key) {
      const c = this.cache[cur]; if (c && Date.now() - c.t < 36e5) return c.v;
      const r = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=FOREX:${cur}&limit=50&apikey=${key}`);
      const j = await r.json(); const feed = j.feed || [];
      let s = 0, n = 0;
      feed.forEach(a => (a.ticker_sentiment || []).forEach(t => { if (t.ticker === `FOREX:${cur}`) { s += +t.ticker_sentiment_score * +t.relevance_score; n += +t.relevance_score; } }));
      const v = n ? Math.max(-1, Math.min(1, (s / n) * 3)) : 0; this.cache[cur] = { t: Date.now(), v }; return v;
    },
    async forSymbol(sym, key) {
      if (!key || !/^[A-Z]{6}$/.test(sym)) return undefined;
      try { const [b, q] = await Promise.all([this.currency(sym.slice(0, 3), key), this.currency(sym.slice(3), key)]); return Math.max(-1, Math.min(1, b - q)); }
      catch { return undefined; }
    },
  };

  global.Brokers = { DemoBroker, MetaApiBroker, BridgeBroker, News, SPECS };
})(window);
