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
| **News** *(optional)* | 20% | Alpha Vantage `NEWS_SENTIMENT`, base-currency score minus quote-currency score (FX pairs only, cached 1 h) |

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

## 2. Entry rules

A trade opens when **all** of these are true:
1. The bot is enabled and the daily loss limit has not been hit
2. `|score| ≥ threshold` (BUY if positive, SELL if negative)
3. `confidence ≥ min confidence`
4. There is no open position on that symbol already
5. Bot positions are below **max open positions**

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
- **Exit on sentiment flip** (optional): a bot BUY closes when the symbol's signal becomes SELL, and the reverse
- Manual close at any time from Home or Portfolio

## 5. Kill-switches

| Guard | Behaviour |
|---|---|
| **Daily loss limit** | When equity today drops `dailyLossPct`% below the day's starting equity, the bot disables itself, logs the reason, and sends a notification |
| **Restart safety** | Live bots never auto-resume after the app restarts |
| **Fingerprint gate** | Enabling the bot on a live account requires biometric confirmation |
| **Bot tagging** | Bot orders carry the comment `TB <score>`. The bot only manages its own positions, never your manual trades |

## 6. Risk presets

| Preset | Risk/trade | Threshold | Min conf. | Max pos. | Daily stop | SL × ATR | TP × ATR |
|---|---|---|---|---|---|---|---|
| Conservative | 0.5% | ±50 | 60% | 2 | −2% | 2.0 | 3.0 |
| Balanced | 1% | ±40 | 50% | 3 | −4% | 1.8 | 3.0 |
| Aggressive | 2% | ±30 | 40% | 5 | −8% | 1.5 | 2.5 |

Changing any slider switches the profile to *Custom*.

## 7. Honest caveats

This is a rules-based technical model. It has **not** been backtested against historical data, and past paper-mode results mean nothing for live markets. Before trusting it with money, forward-test it on a demo account for weeks across different market regimes.
