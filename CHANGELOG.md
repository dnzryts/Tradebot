# Changelog

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
