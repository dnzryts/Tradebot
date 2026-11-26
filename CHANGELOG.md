# Changelog

## [1.12.1] - 2026-11-26
### Changed
- **Live data refreshes every second** on Paper and Own VPS. Before, Paper prices moved every 1.5 s but the screen refreshed every 2 s, so updates arrived 2–3 s apart. Now prices, P/L and equity update together once a second, and the refresh ring counts down 1 s.
- Paper prices tick every second. Each tick's move is scaled so candles keep the same size and still close about every 18 s.
- MetaApi accounts stay at 5 s, because MetaApi charges each request against a credit allowance and faster polling could get the account throttled.
- A refresh is skipped instead of overlapping when the previous one hasn't finished, for example on a slow connection to the VPS.

## [1.12.0] - 2026-11-26
### Added
- **Economic calendar (no key needed).** The app loads the week's ForexFactory calendar and refreshes it every hour. It keeps the last copy on your phone in case the next update fails.
  - **The bot pauses around high-impact news.** New trades for a symbol are skipped from 30 min before until 30 min after a high-impact event for its currencies. For example, US CPI or Non-Farm Payrolls pause USD pairs, gold, US indices and crypto, and an ECB decision pauses EUR pairs and GER40. Open trades keep their stops and targets.
  - The pause is on by default and always on at Beginner level. It's in Auto-Trade → Strategy settings (Moderate and Pro).
  - The strategy radar shows it, for example "⏸ News pause: USD CPI m/m in 12m".
  - **News & events card on Home:** the next high- and medium-impact events for your symbols' currencies, with countdown, forecast and previous value, a banner when the bot is pausing, and the news tone per currency.
  - **Market news panel** (Home → All news, Profile → News, or a symbol's panel): the week's calendar grouped by day (your currencies or all), plus Headlines.
  - **Symbol panel:** upcoming events for that symbol's currencies.
  - **Trade chart:** a warning when high-impact news is due within 2 h, since prices can jump past a stop-loss or take-profit.
- **Headlines** tab: the latest articles with their per-currency tone, for anyone with an Alpha Vantage key. Tap one to open it.

### Fixed
- **News sentiment stopped working after a few hours.** It made one request per currency every hour, which used up the free 25-a-day Alpha Vantage limit early. After that every score silently became 0.
  - It now makes one request every 90 min (16 a day), rotating between monetary-policy, markets and macro news.
  - It keeps a 24-hour pool of articles on the phone and shows a clear message when the limit is reached.
- News sentiment covers more than forex pairs now:
  - Gold and silver use the dollar's tone, inverted.
  - US indices use the overall market tone.
  - Crypto uses the coin's own tone.
- **A handful of articles could push the news factor to its maximum.** It now scales with how much coverage there is, reaching full strength at 8 or more recent articles.

## [1.11.0] - 2026-11-25
### Added
- **Trade detail chart.** Tap any open trade, in Portfolio → Open positions or on a Dashboard live-trade card, to open its chart.
  - Candles with lines for **take-profit**, **entry** and **stop-loss**, each labelled with the projected P/L at that price, plus the live price.
  - A levels table: price, distance from the current price (in pips for forex) and **P/L if the price gets there**.
  - **To target** (% of the way to take-profit), **reward : risk**, and the current result in R (multiples of the amount risked).
  - **Protect profits** status: the profit level where trailing starts, or how much the trailing stop has already locked in. A locked stop is drawn in green as "Stop 🔒".
  - Buttons to close the trade or open the symbol's analysis and order panel.
  - The sheet updates live, and closes itself with a note when the trade closes.
- Open-position rows show a › and trade cards show "Chart ›" to make them recognisable as tappable.

## [1.10.0] - 2026-11-25
### Added
- **Protect profits (trailing stop)**, on in all tested presets. Once a bot trade is in profit by the amount it risks (1 R), its stop-loss follows the price 1 R behind, so a trade that runs up and then reverses still closes in profit. The stop only ever moves in the trade's favour. The take-profit stays where it was.
  - Example: a 0.13-lot GBPUSD buy risking about $32. From about +$32 the stop starts moving up, locking in more profit as the price rises.
  - Backtest with Balanced: +41 R → **+47 R** (Jun 2025 – May 2026) and +8.7 R → **+12.5 R** (Jan – May 2025), with the win rate rising from 44% to 50%. Taking profit earlier instead (at 2 ATR) did worse: −1 R and −15 R.
  - Every move is written to the activity log, e.g. "🔒 EURUSD: stop moved to 1.08314 (locks +$19.20)". Trades closed this way show as **🔒 Trailing stop (profit locked)**, not "Stop-loss hit".
  - The switch is in Auto-Trade → Strategy settings (Moderate and Pro levels). It is part of the tested-settings check.
  - It runs while the bot is running and only manages bot trades.

### Bridge 1.3.0
- New `POST /positions/{id}/modify` (moves SL/TP). Re-run `install.ps1` on the VPS to update. With an older bridge, the app logs that Protect profits needs 1.3.0 and leaves stops unchanged.

## [1.9.0] - 2026-11-25
### Added
- **Trading experience levels: Beginner, Moderate and Pro trader.** You pick one when creating your profile, and can change it any time in Profile → Trading experience.
  - **Beginner:** only the tested Conservative and Balanced presets and your symbols. The bot always uses Auto strategy and volatility (ATR) stops. Switching to Beginner resets custom settings to the tested values, after asking first.
  - **Moderate:** adds strategy choice, timeframe (15m, 1h, 4h), trend filter, flip exit, $ and basket targets, and money management. Entry threshold, confidence and ATR sliders stay hidden.
  - **Pro trader:** every setting, including 5m charts and scan interval.
  - Existing profiles start as Pro trader, so nothing disappears after updating.
- **Tested-settings card** at the top of Auto-Trade settings, always visible.
  - It shows "✓ Tested Balanced settings" (or Conservative or Aggressive) when your settings match a backtested preset.
  - Otherwise it shows "Custom settings · not tested" and lists what differs (for example timeframe or stop-loss), with a **Reset to tested** button. Your symbols are kept.
  - This replaces the one-time prompt from 1.8.0.
- **Getting started guide.** Five steps: watch the bot on Paper, keep the tested settings, connect an MT5 demo account, run it for 2–4 weeks (30+ closed trades), then go live small. Steps tick off on their own, and each has a "Go there" link.
  - Open it from the tested-settings card or from Profile.
  - Beginner and Moderate users also see a progress card on the Dashboard, which can be turned off in Profile.

### Changed
- New profiles default to Beginner with the Conservative preset.
- Tapping a risk preset also resets strategy to Auto and targets to ATR, matching what was tested.

## [1.8.0] - 2026-11-25
### Changed
- **Bot rebuilt after a backtest on real prices.** The bot was replayed over 16 months of real MT5 data (EURUSD, gold, US500). With the old logic and the settings in use (5m, ±23, 83%, SL 4.2, TP 7.2) it lost about 466 R over 7,141 trades, no better than random entries. Nearly all of that loss was spread.
  - Decisions use **closed candles only**, at most once per new candle. Before, the bot re-read the still-forming candle every 10 seconds and jumped in and out on noise.
  - **Sentiment-flip exit is stricter.** A trade must last 4+ candles, and the score must swing to 1.5 × the threshold against it. This exit used to close 58% of trades, mostly at a small loss.
  - New **Follow the bigger trend** filter (on by default). The bot only buys when the next timeframe up (for example 1h for 15m) is trending up, and only sells when it is trending down.
  - New **spread guard**: the bot skips a trade when the spread is more than 10% of the stop distance.
  - **New tested presets.** Balanced: 15m, ±25, 80%, SL 4 / TP 7 ATR. Conservative: 1h. Aggressive: 15m, ±20, 75%, SL 3.5 / TP 6. The old presets lost money because their tight stops made spread a large share of each trade.
  - Results with the new Balanced preset: +41 R from Jun 2025 to May 2026, and +9 R on Jan to May 2025, a period not used for tuning. The edge is thin and came mostly from gold.
- Auto-Trade shows a one-time prompt to apply the tested settings. A warning appears under Timeframe when 5m is selected.

### Added
- **Where P/L comes from** on Portfolio: profit and loss grouped by how trades closed (stop-loss, take-profit, sentiment flip, by you), so a leaking exit is easy to spot.
- `tools/backtest/`: the backtester, and the results table in `docs/STRATEGY.md`.

## [1.7.5] - 2026-11-25
### Changed
- **Smoother page transitions.** The old curve covered ~80% of the distance in the first half and then braked hard ("hitting a wall").
  - Bottom-bar taps and Back use a standard ease-in-out over 0.32 s.
  - A released swipe glides on from the finger's speed and slows down evenly (0.2–0.38 s).
  - Spring-back settles more softly.

## [1.7.4] - 2026-11-25
### Changed
- **Bottom-bar taps and Back now use the same side-by-side slide as swiping.** The new page slides in beside the current one, in the right direction even when jumping across tabs (e.g. Home → Profile), in about 0.25 s with no fade. The tapped icon highlights immediately.

## [1.7.3] - 2026-11-25
### Fixed
- **Pages flickered after a swipe.** When a swipe finished, the new page was rebuilt with the default fade-in animation even though it had already slid into view, so it flashed. Pages that arrive by swipe now appear with no entry animation, and live refreshes can't restart it. Tapping the bottom bar keeps its slide-in.

## [1.7.2] - 2026-11-25
### Added
- **About section** at the bottom of Profile:
  - The installed version and build number (read from Android itself), plus commit and build date.
  - Connection type, and the bridge version when using Own VPS.
- **What's new**: the full changelog inside the app. After an update, a one-time "Updated to vX" note links to it.
- The changelog is bundled into each build automatically (`scripts/gen-version.mjs` writes `www/js/version.js` from `package.json` and `CHANGELOG.md`).

### Fixed
- The Profile footer showed a hard-coded "v1.0".

## [1.7.1] - 2026-11-25
### Changed
- **Native-style page swiping with no delay.**
  - The neighbouring page is rendered beside the current one, and both move exactly 1:1 with the finger (no fade).
  - On release, the slide finishes from where the finger left it, at the finger's speed (about 80–180 ms), and the new page is already in place, with no second animation.
  - The start threshold is 5 px. A short drag springs back. The first and last tabs resist.

## [1.7.0] - 2026-11-25
### Added
- **Markets: full symbol lists with categories and search.**
  - With MT5 connected, Markets shows your broker's whole symbol list, grouped by MT5's own folders (Forex, Metals, Energy, Indices, Crypto, Stocks), with descriptions.
  - Filter chips show counts. There is a ⭐ Watchlist tab, search by name or description (e.g. "gold", "JPY", "oil"), and *Show more* paging.
  - Only rows on screen are analysed, so lists of hundreds stay fast.
  - A ⭐ on each row adds or removes the symbol from the bot's watch list.
- **Paper trading now has 28 symbols:** 7 forex majors, 7 crosses (EURGBP, EURJPY, GBPJPY, AUDJPY, EURAUD, EURCHF, CADJPY), metals (gold, silver, platinum), energy (WTI, Brent, natural gas), indices (US30, US500, NAS100, GER40, UK100, JP225) and crypto (BTC, ETH). P/L converts correctly from each symbol's quote currency (GBP, JPY, EUR, CHF, CAD, AUD) to USD.

### Changed
- Lot sizing and Fixed $ targets use MT5's exact **tick value per lot** when the broker provides it, so they're correct for crosses, metals, oil and indices. They fall back to contract size and quote-currency conversion otherwise.
- The Auto-Trade symbol chips show your watch list first.

### Bridge 1.2.0
- New `GET /symbols/catalog` (names, MT5 folder paths, descriptions); `spec` adds `tickSize`, `tickValue`, `path`, `description`. Re-run `install.ps1` on the VPS to update. Older bridges still work, with categories inferred from symbol names.

## [1.6.3] - 2026-11-25
### Changed
- **Smoother page swiping.**
  - The page now follows your finger (slide plus slight fade) and commits when dragged past about 20% of the width or flicked quickly. Otherwise it springs back.
  - There is no time limit, so slow swipes work, and the first and last tabs rubber-band.
  - Swipes work over charts. The trade carousel and symbol chips take the swipe only when they actually have more to scroll.
  - Vertical scrolling is locked while swiping sideways. Live refreshes pause during a swipe. The browser handles vertical panning natively (`touch-action: pan-y`), and the enter animation is faster.

## [1.6.2] - 2026-11-25
### Changed
- **Dashboard card opacity uses tap-only controls instead of a slider**, so scrolling through Profile can't change it by accident. There are − / + buttons (5% steps, 15–100%, disabled at the limits) and one-tap presets: 25%, 50%, 65%, 80%, 100%.

## [1.6.1] - 2026-11-25
### Fixed
- **The eye button no longer reloads the screen.** Hiding or showing amounts now patches only the values in place, with the same flicker-free update as the live refresh. Scroll position, charts, open panels and animations are untouched.
- The card-opacity preview in Profile also hides its amount.
- Switching tabs now reliably starts the new tab at the top.

## [1.6.0] - 2026-11-25
### Added
- **👁 Hide sensitive data.** An eye button in the top bar of every screen hides money amounts as `$•••••`, with no win/loss colours. This covers equity, balance, margin, every P/L (trade cards, Portfolio, dialogs, messages, activity log), your email and MT5 login, and the equity chart. Prices and lot sizes stay visible.
- **Profile → Privacy:**
  - *Hide amounts when the app opens*: the default mode, applied at launch and every time the app unlocks.
  - *Hidden right now*: the same switch as the eye button.

## [1.5.4] - 2026-11-25
### Fixed
- **Closed trades were all labelled "Manual" in paper mode**, including the bot's own exits (sentiment flip, back to mean), Close all and basket closes. Every close now records its real reason, and Closed trades shows it: 🤖 bot exit, ✋ closed by you, ⛔ Close all, 🎯 take-profit, 🛑 stop-loss. For MT5 accounts the reason is sent with the close order and read back from the deal comment (bridge 1.1.0; MetaApi close comment).
- A tap on **Close** while swiping the live trade card is ignored.

### Added
- **Confirm before closing a trade** (Profile → Trading safety): *All trades* (default), *Losing only* or *Off*. The dialog shows the trade, whether it is a bot or manual trade, and the current P/L, with a clear "Close at a loss" warning.
- **Auto-Trade settings lock.** Strategy, risk profile, symbols, sliders and targets are locked by default so scrolling can't change them. Tap *Unlock to edit* (fingerprint on live accounts); settings lock again when you leave the tab or after 2 minutes.

### Bridge 1.1.0
- `/positions/{id}/close` accepts an optional `{comment}` with the close reason; bot comments are kept in history.

## [1.5.3] - 2026-11-25
### Changed
- Dashboard **Live trades is now a single card**: floating P/L summary on top, then one trade at a time at full card width.
  - Swipe left/right, use the ◀ ▶ arrows, or tap the dots to move between trades; a counter shows e.g. "2 / 3".
  - The visible trade is kept through live refreshes. Closing it moves to the next one.

## [1.5.2] - 2026-11-25
### Changed
- Dashboard live trade cards are stacked vertically (full width, one under another) instead of a sideways-scrolling row. Swiping left or right on them switches tabs like anywhere else.

## [1.5.1] - 2026-11-25
### Fixed
- **Manual orders in Fixed $ mode no longer fail with a bare "target too small" error.**
  - The trade panel pre-fills the lot that fits your $ targets for that symbol (e.g. 0.01 for XAUUSD at $3), shows the targets, and has a one-tap **Use** for the suggested lot.
  - If you enter a larger lot, a dialog explains that the target would sit closer than 3× the spread. It offers the suggested lot, or ATR-based stops for that one trade when no lot fits.
- Manual lots above *Max lot* were capped when SL/TP distances were calculated, even though the order was sent at the full lot. The $ result could be several times the target. Manual lots are now used as entered (within broker limits); Max lot applies only to the bot.
- The trade panel footnote showed ATR multiples even in Fixed $ mode.

## [1.5.0] - 2026-11-25
### Added
- **Live trades on the Dashboard**, right under the equity card:
  - Floating P/L summary with buy/sell and bot/manual counts.
  - A swipeable card for each open trade: side, symbol, strategy (or Manual), live P/L, lot, entry → current price, time open, and a one-tap Close.
  - A progress bar showing where the price sits between stop-loss and take-profit, with the entry marked.
- **Dashboard card opacity** slider (15–100%) in Profile → Appearance, with a live preview. Below 70% the card switches to dark text so it stays readable.

### Changed
- The equity card is lighter by default (65% opacity, soft gradient over the card colour).
- Appearance is simplified to **System / Light / Dark**. The Dark style picker is removed and dark mode always uses Midnight; previously chosen Aurora or Gold map to Midnight.
- Value changes show a soft glow on the digits instead of a coloured block.

### Fixed
- In the light theme, the hidden notification's shadow showed as a grey smudge at the top of the screen.

## [1.4.1] - 2026-11-25
### Fixed
- **Paper trading: wrong closed-trade values after reopening the app.** Each new session re-seeded the simulated market from its original base prices, so open positions saw a sudden price jump and closed at their SL/TP with distorted P/L. The simulated market (300 candles per symbol plus trend regime) is now saved on every new candle and when the app goes to the background, then restored on launch, so prices continue exactly where they left off.
- Paper SL/TP now fill at the stop or target price itself instead of at an overshooting tick, so results match the planned risk and reward.

MT5 accounts (MetaApi and Own VPS) were not affected: their prices and history come from the broker.

## [1.4.0] - 2026-11-25
### Added
- **Appearance: System / Light / Dark.** *System* (now the default) follows the phone's light or dark mode live. A *Dark style* picker (Midnight, Aurora, Gold) sets which dark theme is used.
- Native `ThemeBars` helper (generated by `scripts/patch-android.mjs`) colours the status and navigation bar areas to match the current theme, with dark icons in light mode and light icons in dark mode.

## [1.3.0] - 2026-11-25
### Added
- **Own VPS bridge** (`bridge/`): a free alternative to MetaApi. `bridge.py` is a FastAPI server that runs next to MetaTrader 5 on your own Windows PC or VPS and uses MetaQuotes' official `MetaTrader5` Python package. It has access-key auth, serialised MT5 calls, automatic order-filling-mode selection and Tradebot magic-number tagging.
- `bridge/install.ps1`: one-command Windows installer (Python 3.12, virtual environment, packages, random access key, Caddy HTTPS on `<ip>.sslip.io` or your own domain, firewall, auto-start tasks).
- App: **Profile → Connect MT5 → Own VPS** with Bridge URL and Access key (stored in the Android Keystore). Includes connection checks, an "Algo Trading is OFF" warning, and automatic mapping of the watch list to the broker's symbol names (e.g. `GOLD`, `EURUSD.`).
- docs/VPS_BRIDGE.md: step-by-step setup, maintenance, security, troubleshooting and API reference.

### Changed
- All live-account safety checks (confirmations, restart lock, warnings) apply to both MetaApi and Own VPS.
- Price digits and profit-currency conversion come from the broker's symbol specification when available.
- The app's network policy allows HTTPS to your bridge's domain.

## [1.2.0] - 2026-11-25
### Added
- **Fixed $ targets.** Auto-Trade → Profit & loss targets → *Fixed $ amount* sets take-profit and stop-loss in dollars per trade (default +$3 / −$3). The bot sizes each lot so the target sits about TP × ATR away (within Max lot and broker limits), then sets exact SL/TP prices so the dollar result is fixed on every symbol.
- **Basket targets.** Close all bot trades together when their combined floating P/L reaches +$X (take-profit) or −$Y (stop-loss). Works in both target modes; 0 turns it off.
- Strategy radar and the activity log show the $ targets. Orders are skipped if a $ target is too small for the current spread.

## [1.1.3] - 2026-11-25
### Changed
- Back button no longer steps through every previously visited tab. It closes an open dialog or panel, otherwise goes straight to Home; on Home, press twice to exit.

## [1.1.2] - 2026-11-25
### Changed
- All confirmations (close positions, live orders, enabling live auto-trading, paper reset, sign out) use a themed in-app dialog instead of the plain Android system box. It has an icon, an explanation with P/L where relevant, and Cancel and confirm buttons. Back or tapping outside cancels.

## [1.1.1] - 2026-11-25
### Added
- Swipe left or right on any tab screen to move to the next or previous tab, with a directional slide.
- Bottom sheets: swipe down to dismiss (follows the finger, springs back on short drags, closes on a long drag or flick), slide-up open animation, and an animated close from the backdrop or Back.
- The Close positions sheet updates its counts and P/L live while open.

### Fixed
- The Close all button is now vertically aligned with the section heading, styled as a compact red pill.

## [1.1.0] - 2026-11-25
### Added
- **Adaptive Auto strategy.** Detects each symbol's regime (trending, breakout, ranging or mixed) and runs Trend, Breakout, Reversion or strict Sentiment logic to match. Overall market mood scales position size (×1.25 with the mood, ×0.6 against) and blocks strong counter-mood trend trades.
- Manual strategy choice: Trend, Breakout, Reversion or Sentiment.
- Strategy radar on Auto-Trade: live regime, chosen strategy, reason and signal per symbol.
- **Close all positions** from Home, Portfolio and Auto-Trade, with filters (all, bot only, profitable only, losing only), floating P/L per group, and an option to stop the bot at the same time.
- Android back button: closes the open panel, then returns to the previous tab, then Home; press twice on Home to exit.

### Changed
- Reversion trades take profit at the middle Bollinger band. Other bot trades exit when sentiment turns against them.
- Manual trades are no longer counted or managed as bot trades.
- The app is no longer full screen: it sits below the status bar and above the navigation bar, with both bar areas matching the dark app background.

## [1.0.1] - 2026-11-24
### Fixed
- Screens flickered every refresh because the whole page was rebuilt. Live data is now patched in place: only changed numbers update, and charts, inputs and scroll position are untouched.

### Added
- Circular refresh ring in the top bar that counts down to the next update and spins while fetching. Tap it to refresh now.
- Changed values flash green or red for a moment; the sentiment gauge needle animates smoothly.

## [1.0.0] - 2026-11-24
### Added
- Welcome onboarding, profile setup, PIN and fingerprint lock with auto re-lock
- MT5 connection through MetaApi (register a login or link an existing account ID); token stored in the Android Keystore
- Sentiment engine: 7 technical factors plus optional Alpha Vantage news, confidence score, and a market-mood gauge
- Auto-trader with risk presets, ATR stop-loss/take-profit, risk-based sizing, max positions, exit on flip, and a daily loss kill-switch
- Portfolio: positions, allocation donut, equity curve, trade statistics, history
- Midnight, Aurora, Gold and Light themes; candlestick charts with EMA overlays
- Paper-trading simulator
- GitHub Actions workflow that builds debug and signed release APKs and publishes releases on tags
