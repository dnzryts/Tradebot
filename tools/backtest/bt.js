// Backtest harness: replays Tradebot's Engine + bot rules over real MT5 M1 bars.
// usage: node bt.js '<json config>'  (prints JSON summary)
const fs = require('fs');
global.window = globalThis;
require(process.env.ENGINE || require('path').join(__dirname, '../../www/js/engine.js'));
const E = globalThis.Engine;

const SPEC = {
  EURUSD: { contract: 100000, spread: 0.00012 },
  XAUUSD: { contract: 100, spread: 0.30 },
  'US500.cash': { contract: 1, spread: 0.55 },
};
const TF = { '5m': 5, '15m': 15, '1h': 60 };

function loadM1(sym, fromTs) {
  const txt = fs.readFileSync(require('path').join(process.env.DATA || 'data', `${sym}_m1.csv`), 'utf8').split('\n');
  const out = [];
  for (let i = 1; i < txt.length; i++) {
    const l = txt[i]; if (!l) continue; const p = l.split(',');
    const t = Date.parse(p[0].replace(' ', 'T') + 'Z'); if (t < fromTs) continue;
    out.push({ time: t, open: +p[1], high: +p[2], low: +p[3], close: +p[4], tickVolume: +p[5] });
  }
  return out;
}

function run(cfg) {
  const c = {
    syms: ['EURUSD', 'XAUUSD', 'US500.cash'], from: '2025-06-01', tf: '5m', strategy: 'auto',
    threshold: 23, minConfidence: 83, slAtr: 4.2, tpAtr: 7.2, exitOnFlip: true, flipFrac: .6,
    forming: true,        // analyse the still-forming candle (current app behaviour)
    scanMin: 1,           // how often the bot re-evaluates (minutes)
    cooldownBars: 0, minHoldBars: 0, htf: null, breakEvenR: 0, trailR: 0, spreadMax: 0, random: false,
    riskUsd: 100, seed: 1, to: '2099-01-01', ...cfg,
  };
  let seed = c.seed; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const fromTs = Date.parse(c.from + 'T00:00:00Z'), toTs = Date.parse(c.to + 'T00:00:00Z');
  const trades = [];
  for (const sym of c.syms) {
    const m1 = loadM1(sym, fromTs - 400 * TF[c.tf] * 60000 * (c.htf ? TF[c.htf] / TF[c.tf] : 1));
    const sp = SPEC[sym].spread, tfMs = TF[c.tf] * 60000;
    const closed = []; let cur = null;           // tf candles
    const htfMs = c.htf ? TF[c.htf] * 60000 : 0, hClosed = []; let hCur = null;
    let pos = null, cooldownUntil = 0, lastEvalCandle = -1;
    for (let i = 0; i < m1.length; i++) {
      const b = m1[i]; if (b.time >= toTs) break;
      // 1) manage open position on this bar (bars are bid; buy exits at bid, sell exits at ask = bid+spread)
      if (pos) {
        const buy = pos.side > 0;
        const lo = buy ? b.low : b.low + sp, hi = buy ? b.high : b.high + sp;
        let exit = null, why = '';
        if (buy ? lo <= pos.sl : hi >= pos.sl) { exit = pos.sl; why = 'SL'; }
        else if (buy ? hi >= pos.tp : lo <= pos.tp) { exit = pos.tp; why = 'TP'; }
        if (exit != null) { close(exit, why, b.time); }
        else if (c.breakEvenR || c.trailR || c.trailDist || c.lockPct || c.progMax) {
          const mark = buy ? b.close : b.close + sp, r = pos.risk;
          const gain = (mark - pos.entry) * pos.side;
          if (c.breakEvenR && gain >= c.breakEvenR * r) { const be = pos.entry + pos.side * sp; if (buy ? be > pos.sl : be < pos.sl) pos.sl = be; }
          if (c.trailR && gain >= c.trailR * r) { const t = mark - pos.side * c.trailR * r; if (buy ? t > pos.sl : t < pos.sl) pos.sl = t; }
          if (c.progMax && gain > 0) { const gr = gain / r, f = Math.min(c.progMax, c.progSqrt ? c.progMax * Math.sqrt(gr / c.progSqrt) : (c.progBase || 0) + (c.progSlope || 1) * gr); if (f > 0 && gain * f >= sp) { const t = pos.entry + pos.side * gain * f; if (buy ? t > pos.sl : t < pos.sl) pos.sl = t; } }
          if (c.lockPct && gain >= (c.lockStart || 0) * r && gain * c.lockPct >= sp) { const t = pos.entry + pos.side * gain * c.lockPct; if (buy ? t > pos.sl : t < pos.sl) pos.sl = t; }
          if (c.trailDist && gain >= (c.trailStart || 0) * r && gain > 0) { const t = mark - pos.side * c.trailDist * r; if (buy ? t > pos.sl : t < pos.sl) pos.sl = t; }
        }
      }
      // 2) build candles
      const bucket = Math.floor(b.time / tfMs) * tfMs;
      if (!cur || cur.time !== bucket) { if (cur) closed.push(cur); if (closed.length > 260) closed.shift(); cur = { time: bucket, open: b.open, high: b.high, low: b.low, close: b.close, tickVolume: b.tickVolume }; }
      else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.tickVolume += b.tickVolume; }
      if (c.htf) {
        const hb = Math.floor(b.time / htfMs) * htfMs;
        if (!hCur || hCur.time !== hb) { if (hCur) hClosed.push(hCur); if (hClosed.length > 260) hClosed.shift(); hCur = { time: hb, open: b.open, high: b.high, low: b.low, close: b.close, tickVolume: b.tickVolume }; }
        else { hCur.high = Math.max(hCur.high, b.high); hCur.low = Math.min(hCur.low, b.low); hCur.close = b.close; hCur.tickVolume += b.tickVolume; }
      }
      if (b.time < fromTs || closed.length < 200) continue;
      // 3) when does the bot evaluate?
      const minuteOfCandle = (b.time - bucket) / 60000;
      const candleJustClosed = minuteOfCandle === TF[c.tf] - 1; // this M1 completes the tf candle
      let series;
      if (c.forming) { if ((b.time / 60000) % c.scanMin !== 0) continue; series = [...closed.slice(-199), { ...cur }]; }
      else { if (!candleJustClosed || lastEvalCandle === bucket) continue; lastEvalCandle = bucket; series = [...closed.slice(-199), { ...cur }]; /* cur is now complete */ }
      const a = E.analyse(series, { threshold: c.threshold });
      if (!a) continue;
      // exits
      if (pos) {
        const held = (b.time - pos.time) / tfMs;
        if (c.exitOnFlip && held >= c.minHoldBars && pos.strat !== 'reversion' && (pos.side > 0 ? a.score <= -c.threshold * c.flipFrac : a.score >= c.threshold * c.flipFrac)) {
          close(pos.side > 0 ? b.close : b.close + sp, 'Flip', b.time);
        } else if (pos.strat === 'reversion' && (pos.side > 0 ? a.bb.pctB >= .5 : a.bb.pctB <= .5)) {
          close(pos.side > 0 ? b.close : b.close + sp, 'Mean', b.time);
        }
      }
      if (pos || b.time < cooldownUntil) continue;
      let d;
      if (c.random) { d = rnd() < .02 ? { action: rnd() < .5 ? 'BUY' : 'SELL', slAtr: c.slAtr, tpAtr: c.tpAtr, strategy: 'random' } : { action: 'HOLD' }; }
      else d = E.decide(a, c.strategy, null, c);
      if (d.action === 'HOLD') continue;
      if (c.htf) {
        const h = E.analyse([...hClosed.slice(-199)], {});
        if (!h || (d.action === 'BUY' ? h.ema20 <= h.ema50 : h.ema20 >= h.ema50)) continue;
      }
      if (c.spreadMax && sp > a.atr * d.slAtr * c.spreadMax) continue;
      const side = d.action === 'BUY' ? 1 : -1, entry = side > 0 ? b.close + sp : b.close;
      const slD = a.atr * d.slAtr, tpD = a.atr * d.tpAtr;
      pos = { side, entry, sl: entry - side * slD, tp: entry + side * tpD, risk: slD, time: b.time, strat: d.strategy, sym };
    }
    if (pos) { const lb = m1.filter(x => x.time < toTs).at(-1); close(pos.side > 0 ? lb.close : lb.close + sp, 'End', lb.time); }
    function close(px, why, t) {
      const r = (px - pos.entry) * pos.side / pos.risk;
      trades.push({ sym, r, why, strat: pos.strat, bars: (t - pos.time) / tfMs, spreadR: sp / pos.risk });
      cooldownUntil = t + c.cooldownBars * tfMs; pos = null;
    }
  }
  return summarise(trades, c);
}
function summarise(tr, c) {
  const n = tr.length, wins = tr.filter(t => t.r > 0), losses = tr.filter(t => t.r <= 0);
  const sum = a => a.reduce((s, t) => s + t.r, 0);
  const by = k => Object.fromEntries(Object.entries(tr.reduce((m, t) => ((m[t[k]] ||= []).push(t), m), {})).map(([x, a]) => [x, { n: a.length, R: +sum(a).toFixed(1), win: Math.round(100 * a.filter(t => t.r > 0).length / a.length) }]));
  let eq = 0, peak = 0, dd = 0; tr.forEach(t => { eq += t.r; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); });
  return {
    trades: n, winRate: n ? Math.round(100 * wins.length / n) : 0, netR: +sum(tr).toFixed(1), netUsd: Math.round(sum(tr) * c.riskUsd),
    avgWinR: wins.length ? +(sum(wins) / wins.length).toFixed(2) : 0, avgLossR: losses.length ? +(sum(losses) / losses.length).toFixed(2) : 0,
    pf: losses.length ? +(sum(wins) / -sum(losses) || 0).toFixed(2) : null, maxDdR: +dd.toFixed(1),
    avgBars: n ? +(tr.reduce((s, t) => s + t.bars, 0) / n).toFixed(1) : 0,
    spreadCostR: +tr.reduce((s, t) => s + t.spreadR, 0).toFixed(1),
    exits: by('why'), perSym: by('sym'), perStrat: by('strat'),
  };
}
module.exports = { run };
if (require.main === module) console.log(JSON.stringify(run(JSON.parse(process.argv[2] || '{}')), null, 1));
