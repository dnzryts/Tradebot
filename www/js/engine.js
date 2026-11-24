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
    // Market regime: breakout (volatility expansion through a 20-bar range), trending, ranging or mixed
    const atrSlow = atr(candles, 50), atrRatio = a / (atrSlow || a || 1);
    const prev20 = candles.slice(-21, -1), hi20 = Math.max(...prev20.map(c => c.high)), lo20 = Math.min(...prev20.map(c => c.low));
    const regime = atrRatio > 1.2 && (last > hi20 || last < lo20) ? 'breakout'
      : Math.abs(trend) >= .4 ? 'trending' : Math.abs(trend) < .25 ? 'ranging' : 'mixed';
    return {
      score, confidence, label: label(score), price: last, atr: a, rsi: r, ema20: e20, ema50: e50, macd: m, bb,
      trend, regime, atrRatio, hi20, lo20,
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
  /* ---------- Strategies ----------
     trend     : follow strong, agreeing sentiment in a trending market
     breakout  : trade a volatility expansion through the 20-bar range in the sentiment direction
     reversion : fade Bollinger-band extremes with stretched RSI in a ranging market (quick TP)
     sentiment : classic score/confidence thresholds (strict version used for "mixed" markets)
     auto      : pick per symbol from its regime, then filter/size by overall market mood */
  const STRATEGIES = {
    auto: { label: 'Auto', icon: '✨', desc: 'Adapts per symbol to the market regime and overall mood' },
    trend: { label: 'Trend', icon: '📈', desc: 'Ride strong sentiment in the direction of the trend' },
    breakout: { label: 'Breakout', icon: '🚀', desc: 'Catch volatility bursts through the recent range' },
    reversion: { label: 'Reversion', icon: '🔄', desc: 'Fade overstretched moves in calm, ranging markets' },
    sentiment: { label: 'Sentiment', icon: '🧭', desc: 'Pure sentiment score and confidence thresholds' },
  };
  const REGIME_TO_STRATEGY = { trending: 'trend', breakout: 'breakout', ranging: 'reversion', mixed: 'sentiment' };
  const REGIME_LABEL = { trending: 'Trending', breakout: 'Breakout', ranging: 'Ranging', mixed: 'Mixed' };

  function decide(a, mode, mood, cfg) {
    const out = { action: 'HOLD', strategy: mode, why: 'No setup', slAtr: cfg.slAtr, tpAtr: cfg.tpAtr, riskMult: 1 };
    if (!a) return { ...out, why: 'No data' };
    const auto = mode === 'auto';
    const strat = auto ? REGIME_TO_STRATEGY[a.regime] : mode;
    out.strategy = strat;
    const th = cfg.threshold, mc = cfg.minConfidence, dir = a.score > 0 ? 'BUY' : 'SELL';
    let side = null;
    if (strat === 'trend') {
      if (Math.abs(a.score) >= th && a.confidence >= mc && Math.sign(a.trend) === Math.sign(a.score)) side = dir;
      out.why = `Score ${a.score > 0 ? '+' : ''}${a.score}, with trend`;
    } else if (strat === 'breakout') {
      if (a.price > a.hi20 && a.score >= th * .7) side = 'BUY';
      else if (a.price < a.lo20 && a.score <= -th * .7) side = 'SELL';
      out.slAtr = cfg.slAtr * .85; out.tpAtr = cfg.tpAtr * 1.25; out.why = `Range break, ATR ×${a.atrRatio.toFixed(2)}`;
    } else if (strat === 'reversion') {
      if (a.bb.pctB < .05 && a.rsi < 35) side = 'BUY';
      else if (a.bb.pctB > .95 && a.rsi > 65) side = 'SELL';
      out.slAtr = cfg.slAtr * .7; out.tpAtr = Math.max(1, cfg.tpAtr * .45); out.why = `Band ${Math.round(a.bb.pctB * 100)}%, RSI ${Math.round(a.rsi)}`;
    } else { // sentiment (stricter when auto picked it for a mixed market)
      const t2 = auto ? th + 10 : th, c2 = auto ? mc + 10 : mc;
      if (Math.abs(a.score) >= t2 && a.confidence >= c2) side = dir;
      out.why = `Score ${a.score > 0 ? '+' : ''}${a.score}, conf ${a.confidence}%`;
    }
    // Market-mood overlay: size up with the crowd, size down against it; auto skips strong counter-mood trend trades
    if (side && mood) {
      const aligned = (side === 'BUY') === (mood.score >= 0);
      if (Math.abs(mood.score) >= 40) out.riskMult = aligned ? 1.25 : .6;
      if (auto && strat !== 'reversion' && Math.abs(mood.score) >= 55 && !aligned) { side = null; out.why += ' · against market mood'; }
    }
    out.action = side || 'HOLD';
    return out;
  }

  global.Engine = { analyse, marketMood, decide, STRATEGIES, REGIME_LABEL, ema, sma, rsi, atr, label };
})(window);
