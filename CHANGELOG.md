# Changelog

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
