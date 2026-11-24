# Changelog

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
