# Connecting a MetaTrader 5 account

MetaTrader 5 has no public REST API that a phone app can call directly. Tradebot uses **[MetaApi](https://metaapi.cloud)**, a cloud service that runs an MT5 terminal for your login and exposes it through a REST API.

```
Tradebot (phone) ──HTTPS──▶ MetaApi cloud ──MT5 protocol──▶ Your broker's MT5 server
```

## Step 1: Create a MetaApi token

1. Sign up at https://metaapi.cloud. The free tier is enough for a demo account.
2. Open **API access** (token page) and generate an **API token**. Copy it.

> The token gives full access to your MetaApi accounts. Treat it like a password.

## Step 2: Find your MT5 details

In the MT5 app or desktop terminal, find:
- **Login**: your account number, e.g. `51234567`
- **Password**: the **trading** (master) password. An investor (read-only) password can monitor the account but cannot trade.
- **Server**: the exact server name, e.g. `ICMarketsSC-Demo`, `Exness-MT5Trial7`, `Pepperstone-Demo`

## Step 3: Connect in Tradebot

1. **Profile → Connect MT5**, or tap the 🔗 icon at the top right of any screen.
2. Choose **MT5 via MetaApi** and paste your token.
3. Choose one of:
   - **Add MT5 login**: enter your login, password and server. Tradebot registers the account with MetaApi (`POST /users/current/accounts`, platform `mt5`).
   - **Existing MetaApi account ID**: if you already added the account in the MetaApi dashboard, paste its ID.
4. Tap **Save & connect**. Tradebot deploys the account if needed and waits for `DEPLOYED · CONNECTED`. The first connection can take 1–2 minutes.

When connected, the header shows a green pulse, the dashboard card shows **LIVE MT5**, and balance and positions come from your broker.

### What gets stored

| Item | Stored? | Where |
|---|---|---|
| MetaApi token | Yes | Android Keystore (encrypted) via the biometric plugin |
| MetaApi account ID, login, server, region | Yes | App storage (not secret) |
| MT5 password | **No** | Sent once to MetaApi over HTTPS during registration |

## Symbol names

Brokers often add suffixes (`EURUSD.a`, `XAUUSDm`, `US30.cash`). Once connected, **Auto-Trade → Symbols** lists the symbols your broker actually offers. Pick from that list.

## Safety on live accounts

- Turning on the bot on a live account asks for a confirmation **and** a fingerprint.
- Manual orders and closes on live accounts ask for confirmation.
- After an app restart the bot is **always off** on live accounts. You must re-enable it.
- The scan interval is at least 30 s on MT5, to respect API limits.

## Troubleshooting

| Message | Cause or fix |
|---|---|
| `Account did not connect to broker yet` | Wrong server name or password, or the broker is down. Check the account in the MetaApi dashboard |
| `HTTP 401` / `Unauthorized` | Token is wrong or expired. Generate a new one |
| `HTTP 429` | Rate limit. Increase the scan interval |
| `Order failed: TRADE_RETCODE_INVALID_VOLUME` | Lot is below the broker minimum or not a valid step. Raise risk %, or check the symbol's volume limits |
| `TRADE_RETCODE_MARKET_CLOSED` | Market closed (weekend or session break) |
| Candles missing for a symbol | That symbol has no history on your broker's feed. Remove it from the watch list |
