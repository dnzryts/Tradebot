# Sentiment & risk engine

Source: `www/js/engine.js` (scoring) and `www/js/app.js` → `botCycle()` (execution).

## 1. Sentiment score

For every watched symbol, the engine loads 200 candles on the selected timeframe (5m, 15m, 1h or 4h) and computes seven factors. Each factor is scaled to **−1 (bearish) … +1 (bullish)**:

| Factor | Weight | Logic |
|---|---|---|
| **Trend** | 26% | EMA20 − EMA50, measured in ATR units |
| **Momentum** | 16% | RSI(14) centred on 50 (±25 RSI points = ±1) |
| **MACD** | 18% | MACD(12,26,9) histogram in ATR units, ± a bonus when the histogram is rising or falling |
| **Price/EMA** | 10% | Distance of price from EMA20 in ATR units |
| **ROC** | 10% | 10-bar rate of change relative to volatility |
| **Flow** | 10% | Tick-volume-weighted up candles vs down candles over the last 20 bars |
| **Reversion** | 10% | Contrarian brake: RSI > 75 or above the upper Bollinger band counts bearish; RSI < 25 or below the lower band counts bullish |
| **News** *(optional)* | 20% | Alpha Vantage `NEWS_SENTIMENT`, last 24 h of articles, newer and more relevant ones weighted higher (6 h half-life), shrunk towards 0 with fewer than 8 articles. Forex: (base − quote) ÷ 2. Gold/silver: −USD tone. US indices: tone of `financial_markets` articles. Crypto: the coin's tone. One request every 90 min, rotating topics, within the free 25-a-day limit |

`score = round(100 × Σ(factor × weight) / Σweights)` → **−100 … +100**

| Score | Label |
|---|---|
| ≥ 60 | Strong Bullish |
| 25 … 59 | Bullish |
| −24 … 24 | Neutral |
| −59 … −25 | Bearish |
| ≤ −60 | Strong Bearish |

**Confidence (0–100%)** is the weighted share of factors agreeing with the score's direction (70%) plus the score magnitude (60%), clamped to 100. High confidence means the indicators agree. Low confidence means they disagree.

**Market mood** on the dashboard is the average score across your watch list, plus counts of bullish and bearish symbols.

## 2. Strategies & the Auto mode

Choose a strategy in **Auto-Trade → Strategy**. Every symbol is first classified into a **regime**:

| Regime | Detection |
|---|---|
| **Breakout** | ATR(14) > 1.2 × ATR(50) **and** price beyond the previous 20-bar high or low |
| **Trending** | \|Trend factor\| ≥ 0.40 (EMA20/50 separation ≥ 0.6 ATR) |
| **Ranging** | \|Trend factor\| < 0.25 |
| **Mixed** | anything in between |

| Strategy | Entry | SL / TP (× ATR) | Exit |
|---|---|---|---|
| 📈 **Trend** | \|score\| ≥ threshold, confidence ≥ min, trend factor agrees | SL, TP from settings | Sentiment turns against (≥ 60% of threshold) |
| 🚀 **Breakout** | Price breaks the 20-bar high or low with score ≥ 70% of threshold in the same direction | SL × 0.85, TP × 1.25 | Same as Trend |
| 🔄 **Reversion** | BUY: %B < 5% and RSI < 35. SELL: %B > 95% and RSI > 65 | SL × 0.7, TP × 0.45 (min 1) | Price returns to the middle Bollinger band |
| 🧭 **Sentiment** | \|score\| ≥ threshold and confidence ≥ min | SL, TP from settings | Same as Trend |
| ✨ **Auto** | Trending → Trend, Breakout → Breakout, Ranging → Reversion, Mixed → Sentiment (threshold +10, confidence +10) | per picked strategy | per picked strategy |

**Market-mood overlay.** Market mood is the average score across the watch list. When \|mood\| ≥ 40, trades with the mood use 1.25× risk and trades against it use 0.6×. In Auto mode, non-reversion trades against a strong mood (\|mood\| ≥ 55) are skipped.

Bot orders are tagged `TB <code><score>`, for example `TB T+46` (T = Trend, B = Breakout, R = Reversion, S = Sentiment). The bot uses the tag to apply the right exit rule.

## 2a. Profit & loss targets

**By volatility (ATR)** (default): SL and TP are ATR multiples from the strategy table above, and the lot comes from *Risk per trade* (see Position sizing).

**Fixed $ amount**: you set take-profit and stop-loss in account dollars per trade.

```
lot      = round( TP$ ÷ (TP-multiple × ATR × contract size) )   → clamped to broker min/max and Max lot
TP price = entry ± TP$ ÷ (lot × contract size)                  (× price when the quote currency isn't USD, e.g. USDJPY)
SL price = entry ∓ SL$ ÷ (lot × contract size)
```

The lot is chosen so the target sits a sensible distance away (about the strategy's TP multiple of ATR). The exact prices are then calculated from that rounded lot, so the result at TP or SL equals your dollar amount. When the broker's minimum lot (0.01) forces a bigger lot, the target simply sits closer to the entry.

Examples at +$3 / −$3 (approximate lots): EURUSD 0.02, GBPUSD 0.01, USDJPY 0.01, XAUUSD 0.01, BTCUSD 0.01, US30 0.02.

Notes:
- Spread, commission and swap are **not** included, so the net result is slightly less than the target.
- If a target would sit closer than 3× the current spread, the order is skipped and logged.
- Values assume a USD account. Crosses without USD (e.g. EURGBP) are treated approximately.

**Basket targets** (both modes): when the combined floating P/L of all bot trades reaches **+Basket take-profit** or **−Basket stop-loss**, every bot trade is closed together. 0 = off.

## 2b. Close all

**Close all** (Home, Portfolio, Auto-Trade) offers **All**, **Bot trades only**, **Profitable only** or **Losing only**, showing the count and floating P/L of each group. It can also stop the bot first. Positions close one by one at market, and any failures are listed in the activity log.

## 2c. Entry rules (common)

The bot decides on **closed candles only**. The last candle from the broker is still forming, so it is dropped before analysis, and the bot acts at most **once per newly closed candle** per symbol. The scan interval only controls how quickly a new candle is noticed.

A trade opens when **all** of these are true:
1. The bot is enabled and the daily loss limit has not been hit
2. `|score| ≥ threshold` (BUY if positive, SELL if negative)
3. `confidence ≥ min confidence`
4. There is no open position on that symbol already
5. Bot positions are below **max open positions**
6. **No high-impact news nearby** (*Pause around high-impact news*, on by default): no ForexFactory high-impact event for the symbol's currencies from 30 min before until 30 min after it (e.g. US CPI and NFP block USD pairs, gold, US indices and crypto; ECB blocks EUR pairs and GER40). Open trades are kept, and their stops and targets stay in place.
7. **Follow the bigger trend** (on by default): on the next timeframe up (5m/15m → 1h, 1h → 4h, 4h → 1d), EMA20 is above EMA50 for a BUY, below for a SELL
8. **Spread guard**: the current spread is at most 10% of the stop-loss distance

Candidates are ranked by `|score|`, so the strongest signals fill the free slots first.

## 3. Position sizing

```
risk money   = equity × risk%
SL distance  = ATR(14) × SL-multiple
value / lot  = SL distance × contract size        (÷ price when the quote currency isn't USD, e.g. USDJPY)
lot          = floor((risk money ÷ value/lot) / volume step) × volume step
lot          = clamp(lot, broker min, min(broker max, Max lot setting))
```

Stop-loss = entry ∓ ATR × SL-multiple. Take-profit = entry ± ATR × TP-multiple.

> Sizing assumes a USD account. On non-USD accounts, or on exotic crosses, the real risk per trade differs. Keep **Max lot** conservative.

## 4. Exit rules

- Broker-side **SL / TP** are always attached to the order
- **Exit on sentiment flip** (optional): after the trade has lasted at least **4 closed candles**, a bot BUY closes when the closed-candle score falls to **−1.5 × threshold** or lower, and the reverse for a SELL. (Before v1.8 this fired at 0.6 × threshold on the forming candle, which closed most trades on noise.)
- **Reversion** trades close when price returns to the middle Bollinger band
- **Protect profits** (on in all presets), in two stages. R is the trade's original stop distance. **Stage 1:** at +0.5 R the stop-loss moves to break-even (entry plus the spread), so the trade can no longer lose. **Stage 2:** at +1 R the stop trails 1 R behind the price. The stop only moves forward, in steps of at least 0.1 R. It's checked on every refresh while the bot runs. On Own VPS it needs bridge 1.3.0.
- **Keep % of profit** (optional Protect profits mode, Moderate and Pro levels). Three starts: **Progressive** (default for this mode): from the first profit the stop keeps 0.5 × (profit in R) of the profit, capped at 70/80/90%. For example, at +0.5R it keeps 25%, at +1R 50%, and from +1.8R 90%. Tested (90% cap): +33R / +14R, win rate 78%. **From entry**: from the first profit, the stop keeps 70/80/90% of the current profit and rises with it, never back. In testing this lost about −100R / −58R. **After break-even, from +1R**: break-even at +0.5R as Standard; then from +1R the stop keeps 70%, 80% or 90% of the current profit and rises with it, never back. Tested: keeping 90% made +44R / +17R against +52R / +18R for Standard. Keeping a % from the very first profit lost about −100R / −58R, because tiny profits leave tiny gaps that normal ticks hit at once. Each trade records its mode, and Portfolio → Bot performance → Protect compares them.
- Manual close at any time from Home or Portfolio

## 5. Kill-switches

| Guard | Behaviour |
|---|---|
| **Daily loss limit** | When equity today drops `dailyLossPct`% below the day's starting equity, the bot disables itself, logs the reason, and sends a notification |
| **Restart safety** | Live bots never auto-resume after the app restarts |
| **Fingerprint gate** | Enabling the bot on a live account requires biometric confirmation |
| **Bot tagging** | Bot orders carry the comment `TB <score>`. The bot only manages its own positions, never your manual trades |

## 5a. Trade journal and guardrails

Every trade is journaled when it opens, with its strategy, market type, score, confidence, bigger-trend check, news tone and minutes to the next high-impact event. Its result is attached when it closes: P/L, R (P/L ÷ the amount risked at entry), exit reason and duration. Portfolio → **Bot performance** groups results by symbol, strategy, market type and news state.

**Guardrails** (on by default): if a symbol or strategy has lost **5 R or more over its last 30 bot trades** with a profit factor under 0.8, the bot stops opening trades on it. It logs the decision and sends a notification. Nothing else changes: risk, settings and open trades are untouched. **Resume** in Auto-Trade starts its count from zero. Stats are kept separately for Paper and each MT5 account.

**Storage:** the active journal holds open trades plus the latest 300 closed ones. Older trades move to an archive in batches of 100, about 9 ms each time. The archive keeps at most 2,000 trades in compact form (about 470 KB). Beyond that, only running totals per symbol and strategy are kept. On each 1-second refresh only the few open entries are checked. Stats are recalculated only when a trade closes, and cached.

## 6. Risk presets

| Preset | Timeframe | Risk/trade | Threshold | Min conf. | Max pos. | Daily stop | SL × ATR | TP × ATR |
|---|---|---|---|---|---|---|---|---|
| Conservative | 1h | 0.5% | ±25 | 80% | 2 | −2% | 4.0 | 7.0 |
| Balanced | 15m | 1% | ±25 | 80% | 3 | −4% | 4.0 | 7.0 |
| Aggressive | 15m | 2% | ±20 | 75% | 5 | −8% | 3.5 | 6.0 |

All presets turn on *Follow the bigger trend* and *Exit when sentiment flips*, and use the Auto strategy with ATR targets. The tested-settings card on Auto-Trade shows whether the current settings match a preset, and resets them in one tap. Beginner level only offers Conservative and Balanced; Moderate hides the threshold, confidence and ATR sliders; Pro trader shows everything. Changing any slider or the timeframe switches the profile to *Custom*.

## 6a. Backtest (v1.8.0)

`tools/backtest/` replays the real engine (`www/js/engine.js`) and the bot rules over MT5 M1 bars, checking SL/TP bar by bar with the spread charged on every trade. Data: [Gianniskas/mt5-m1-bars-us500-eurusd-xauusd](https://github.com/Gianniskas/mt5-m1-bars-us500-eurusd-xauusd), EURUSD, XAUUSD and US500, Jan 2025 to May 2026. Spreads assumed: EURUSD 1.2 pips, gold $0.30, US500 0.55. Results are in **R** (1R = the amount risked per trade; at 1% risk on $10,000, 1R = $100).

```
DATA=/path/to/mt5bars node tools/backtest/matrix.js '{"from":"2025-06-01"}' cases.json
```

| Setup | Trades | Win % | Net (Jun 25 – May 26) | Net (Jan – May 25, unseen) | Spread paid |
|---|---|---|---|---|---|
| v1.7 logic, 5m, ±23, 83%, SL 4.2, TP 7.2 | 7,141 | 38% | **−466 R** | −100 R | 472 R |
| v1.7 Balanced preset (15m, SL 1.8, TP 3) | 4,401 | 36% | −275 R | — | 330 R |
| Random entries, same SL/TP | 1,556 | 34% | −110 R | — | 67 R |
| v1.8 logic, 5m | 3,240 | 41% | −118 R | −6 R | 199 R |
| **v1.8 Balanced** (15m) | 1,246 | 44% | **+41 R** | **+9 R** | 38 R |
| v1.8 Conservative (1h) | 385 | 44% | +15 R | +17 R | 6 R |
| v1.8 Aggressive (15m) | 1,484 | 42% | +29 R | +19 R | 54 R |
| v1.10 Balanced + Protect profits (1 R trailing) | 1,299 | 50% | +47 R | +12.5 R | 39 R |
| **v1.16 Balanced + break-even at +0.5 R, then 1 R trailing** | 1,441 | 63% | **+52 R** | **+18 R** | 43 R |
| Lock profit from the first +0.25 R (0.25 R trailing) | 2,581 | 75% | +17 R | +2 R | — |
| Balanced with an earlier TP (2 ATR) | 2,157 | 62% | −1 R | −15 R | 62 R |

What this showed:
- The v1.7 bot did about as well as **random entries**. Almost the whole loss was spread: it traded thousands of times on the forming 5-minute candle, and 58% of trades were closed by the sentiment-flip exit at a small loss.
- Fewer, longer trades on closed candles, with the higher-timeframe filter and a stricter flip exit, turned it into roughly break-even to slightly positive in **both** periods.
- Every 5-minute setup lost money. The edge that remains is thin (profit factor 1.03–1.2) and came mostly from gold; EURUSD was slightly negative in most setups.

## 7. Honest caveats

This is a rules-based technical model. The backtest above covers one data source, three symbols and about 16 months; it ignores commission, swaps, slippage, the market-mood overlay, news sentiment and the news pause (no historical news was available to test them), and a thin edge like this can disappear in other conditions. Paper mode uses a **random** price simulator, so paper results say nothing about the strategy, good or bad. Before trusting it with money, forward-test it on a demo account for weeks across different market regimes.
