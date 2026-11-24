/* Tradebot analysis engine: indicators + market sentiment scoring.
   Candles: [{time, open, high, low, close, tickVolume}] oldest -> newest. */
(function (global) {
  const ema = (vals, n) => {
    const k = 2 / (n + 1); const out = []; let prev;
    vals.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
    return out;
  };
  const sma = (vals, n) => vals.map((_, i) => i < n - 1 ? null : vals.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n);

  function rsi(closes, n = 14) {
    if (closes.length <= n) return 50;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; d > 0 ? g += d : l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function atr(c, n = 14) {
    const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
    return ema(tr, n).at(-1);
  }
  function macd(closes) {
    const f = ema(closes, 12), s = ema(closes, 26); const line = f.map((v, i) => v - s[i]);
    const sig = ema(line, 9); return { line: line.at(-1), signal: sig.at(-1), hist: line.at(-1) - sig.at(-1), prevHist: line.at(-2) - sig.at(-2) };
  }
  function bollinger(closes, n = 20) {
    const w = closes.slice(-n); const m = w.reduce((a, b) => a + b, 0) / w.length;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length) || 1e-9;
    return { mid: m, upper: m + 2 * sd, lower: m - 2 * sd, pctB: (closes.at(-1) - (m - 2 * sd)) / (4 * sd) };
  }
  const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

  /* Each factor returns a value in [-1, 1] (bearish..bullish). */
  function analyse(candles, opts = {}) {
    if (!candles || candles.length < 60) return null;
    const closes = candles.map(c => c.close);
    const last = closes.at(-1);
    const e20 = ema(closes, 20).at(-1), e50 = ema(closes, 50).at(-1);
    const r = rsi(closes), m = macd(closes), bb = bollinger(closes), a = atr(candles);
    const roc = (last - closes.at(-11)) / closes.at(-11);

    const trend = clamp(((e20 - e50) / (a || 1e-9)) / 1.5);               // EMA alignment in ATR units
    const momentum = clamp((r - 50) / 25);                               // RSI centred
    const macdF = clamp((m.hist / (a || 1e-9)) * 4 + (m.hist > m.prevHist ? .15 : -.15));
    const priceVsEma = clamp(((last - e20) / (a || 1e-9)) / 2);
    const roc10 = clamp(roc / ((a / last) * 4 || 1e-9));
    // Mean reversion guard: overbought/oversold dampens chasing.
    const extremes = r > 75 ? -.6 : r < 25 ? .6 : bb.pctB > 1 ? -.4 : bb.pctB < 0 ? .4 : 0;
    // Volume-weighted pressure from last 20 candles
    const recent = candles.slice(-20); let up = 0, dn = 0;
    recent.forEach(c => { const v = c.tickVolume || 1; c.close >= c.open ? up += v : dn += v; });
    const pressure = clamp((up - dn) / (up + dn || 1) * 2);

    const factors = [
      { key: 'Trend', v: trend, w: .26 },
      { key: 'Momentum', v: momentum, w: .16 },
      { key: 'MACD', v: macdF, w: .18 },
      { key: 'Price/EMA', v: priceVsEma, w: .1 },
      { key: 'ROC', v: roc10, w: .1 },
      { key: 'Flow', v: pressure, w: .1 },
      { key: 'Reversion', v: extremes, w: .1 },
    ];
    if (typeof opts.news === 'number') factors.push({ key: 'News', v: clamp(opts.news), w: .2 });
    const wsum = factors.reduce((s, f) => s + f.w, 0);
    const raw = factors.reduce((s, f) => s + f.v * f.w, 0) / wsum;
    const score = Math.round(raw * 100);
    // Confidence: agreement between factors
    const sign = Math.sign(raw) || 1;
    const agree = factors.filter(f => Math.sign(f.v) === sign && Math.abs(f.v) > .1).reduce((s, f) => s + f.w, 0) / wsum;
    const confidence = Math.round(clamp(agree * .7 + Math.abs(raw) * .6, 0, 1) * 100);
    return {
      score, confidence, label: label(score), price: last, atr: a, rsi: r, ema20: e20, ema50: e50, macd: m, bb,
      factors: factors.map(f => ({ key: f.key, v: Math.round(f.v * 100) })),
      signal: score >= (opts.threshold ?? 35) ? 'BUY' : score <= -(opts.threshold ?? 35) ? 'SELL' : 'HOLD',
    };
  }
  function label(s) {
    if (s >= 60) return 'Strong Bullish'; if (s >= 25) return 'Bullish'; if (s > -25) return 'Neutral';
    if (s > -60) return 'Bearish'; return 'Strong Bearish';
  }
  /* Aggregate market mood from many symbols. */
  function marketMood(list) {
    const valid = list.filter(Boolean); if (!valid.length) return { score: 0, label: 'Neutral', bulls: 0, bears: 0 };
    const score = Math.round(valid.reduce((s, x) => s + x.score, 0) / valid.length);
    return { score, label: label(score), bulls: valid.filter(x => x.score >= 25).length, bears: valid.filter(x => x.score <= -25).length };
  }
  global.Engine = { analyse, marketMood, ema, sma, rsi, atr, label };
})(window);
