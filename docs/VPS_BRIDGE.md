# Own VPS bridge: connect Tradebot to MT5 for free

The bridge is a small server that runs **next to MetaTrader 5 on your own Windows PC or VPS**. It uses MetaQuotes' official, free [`MetaTrader5` Python package](https://www.mql5.com/en/docs/python_metatrader5), so you don't need MetaApi or any other paid cloud service.

```
Tradebot (phone) ──HTTPS──▶ Caddy (your VPS) ──▶ bridge.py ──▶ MetaTrader 5 terminal ──▶ XM server
```

| | Own VPS bridge | MetaApi |
|---|---|---|
| Cost | VPS only (≈ $7–12/month), or $0 on a PC that stays on | $30+/month subscription + usage |
| Where your MT5 password lives | Only inside MT5 on your server | MetaApi's cloud |
| Setup | One-time, about 30 minutes | 5 minutes |
| Maintenance | Keep MT5 logged in; occasional Windows updates | None |

---

## 1. Get a Windows server

Any Windows PC that stays on works. A **Windows VPS** is the reliable option:
- Windows Server 2019/2022 (or Windows 10/11)
- **4 GB RAM or more**, 2+ CPU cores
- A European data centre (London, Amsterdam or Frankfurt) is usually closest to XM's servers
- Pay **monthly** at first

Your provider emails you the server's **IP address, user name and password**.

## 2. Connect with Remote Desktop

- **Android:** install *Windows App* (formerly *Remote Desktop*) from the Play Store, add a PC with the IP, then log in.
- **Windows PC:** press `Win+R`, type `mstsc`, then enter the IP.

> When you leave, **close the Remote Desktop window with ✕** (disconnect). **Don't "Sign out"**: MT5 and the bridge run inside your session.

## 3. Install XM MetaTrader 5 on the server

1. On the VPS, open a browser, download **MT5 from xm.com** and install it.
2. Log in with your XM **login, password and server**, and tick **Save password**.
3. Click **Algo Trading** in the toolbar so it turns green.
4. Optional, but makes trading lighter: Tools → Options → Expert Advisors, then untick everything except "Allow algorithmic trading".

Start with your **XM demo account**.

## 4. Run the installer

On the VPS, open **PowerShell as Administrator** (right-click Start → *Terminal (Admin)* or *Windows PowerShell (Admin)*) and paste:

```powershell
iwr https://raw.githubusercontent.com/dnzryts/Tradebot/main/bridge/install.ps1 -OutFile $env:TEMP\tb.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\tb.ps1
```

The installer:
1. Downloads the bridge into `C:\Tradebot\bridge`
2. Installs **Python 3.12** if needed, then `MetaTrader5`, `fastapi` and `uvicorn` in a private virtual environment
3. Generates a long random **access key**
4. Sets up **HTTPS** with [Caddy](https://caddyserver.com) and a free address like `https://51-89-12-34.sslip.io` (your IP with dashes). The certificate is issued and renewed automatically.
5. Opens Windows Firewall ports **80 and 443**
6. Registers two auto-start tasks: **Tradebot Caddy** (at boot) and **Tradebot Bridge** (when you log on)
7. Prints the **Bridge URL** and **Access key**, also saved in `C:\Tradebot\CONNECTION.txt`

> **Provider firewall:** some VPS providers have their own firewall in their control panel. Open **TCP 80 and 443** there too, or HTTPS can't be set up.

**Optional switches**
- `-Domain bridge.mydomain.com` uses your own domain instead of sslip.io. Point its DNS A record at the VPS first.
- `-NewKey` creates a new access key; the old one stops working.
- `-Port 9000` changes the local bridge port (default 8787).

## 5. Connect the app

In Tradebot: **Profile → Connect MT5** (or the 🔗 icon) **→ Own VPS**, enter the **Bridge URL** and **Access key**, then tap **Save & connect**.

Tradebot checks the bridge and shows your MT5 account. It then matches your watch list to the broker's symbol names; for example, XM may use `GOLD` for `XAUUSD`, or add suffixes like `EURUSD.`/`EURUSD#`. The access key is stored encrypted in the Android Keystore.

If the app says **"Algo Trading is OFF"**, click the *Algo Trading* button in MT5 on the VPS.

---

## Keeping it running

- **After a VPS reboot:** log in once with Remote Desktop. MT5 and the bridge start on their own. To skip even that, enable automatic logon with Microsoft's free **Sysinternals Autologon** tool.
- **Check it's alive:** open `https://<your-address>/health` in a phone browser. It should show `{"ok":true,...}`.
- **Logs:** `C:\Tradebot\bridge\bridge.log` lists every trade and close the bridge executed.
- **Update the bridge:** run the installer again. It keeps your access key.
- **Restart manually:** Task Scheduler → *Tradebot Bridge* → *Run*.

## Uninstall

In an Administrator PowerShell:

```powershell
Unregister-ScheduledTask -TaskName "Tradebot Bridge" -Confirm:$false
Unregister-ScheduledTask -TaskName "Tradebot Caddy" -Confirm:$false
Get-NetFirewallRule -DisplayName "Tradebot HTTPS" | Remove-NetFirewallRule
Remove-Item C:\Tradebot -Recurse -Force
```

## Security

- The bridge only listens on `127.0.0.1`. The outside world reaches it **only through Caddy over HTTPS**.
- Every request (except `/health`) must carry the **access key**, compared in constant time; wrong keys are delayed. The key is 256 bits of randomness, so it can't be guessed.
- `config.json` and `CONNECTION.txt` are readable only by your Windows user, SYSTEM and Administrators.
- Your **MT5 password is never stored by the bridge**. It attaches to the MT5 terminal you logged into.
- The bridge can trade but **can't withdraw money**. Withdrawals need your XM Members Area login.
- If the key leaks, run the installer with `-NewKey` and update the app.

## Troubleshooting

| Problem | Fix |
|---|---|
| App: *Cannot reach the bridge* | Check the URL. Open `https://<address>/health` in a browser. Open ports 80/443 in the provider's firewall. Make sure the VPS is running. |
| App: *Access key rejected* | Copy the key again from `C:\Tradebot\CONNECTION.txt`, with no spaces. |
| App: *Cannot attach to MetaTrader 5* | MT5 isn't open or not logged in. Log in via Remote Desktop and tick *Save password*. |
| Orders fail with `TRADE_RETCODE_CLIENT_DISABLES_AT` / *AutoTrading disabled* | Turn on **Algo Trading** in MT5. |
| `TRADE_RETCODE_INVALID_STOPS` | SL/TP too close to the price for that symbol. Use a larger $ target or ATR mode. |
| `TRADE_RETCODE_MARKET_CLOSED` | Market closed (weekend or session break). |
| HTTPS never works with sslip.io | Rarely, the certificate authority rate-limits the shared sslip.io domain. Wait an hour (Caddy retries and falls back to ZeroSSL automatically), or use `-Domain` with your own domain. |
| Everything stops after a reboot | Log in once by Remote Desktop, or set up Autologon. |

## Bridge API (for developers)

All responses are JSON. Every endpoint except `/health` needs `Authorization: Bearer <access key>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check (no auth) |
| GET | `/status` | Terminal and broker connection, Algo Trading state, login, server |
| GET | `/account` | Balance, equity, margin, free margin, currency, leverage |
| GET | `/positions` | Open positions (`id`, `symbol`, `type`, `volume`, prices, SL/TP, `profit`, `comment`, `magic`) |
| GET | `/history?days=30` | Closed deals (profit includes commission, swap and fees) |
| GET | `/symbols` | Broker symbols (Market Watch first) |
| GET | `/symbols/{s}/spec` | Digits, contract size, volume limits, stops level, profit currency |
| GET | `/symbols/{s}/price` | Bid / ask |
| GET | `/symbols/{s}/candles?timeframe=15m&limit=200` | OHLC candles (`1m 5m 15m 30m 1h 4h 1d`) |
| POST | `/trade` | `{symbol, side: BUY\|SELL, volume, stopLoss?, takeProfit?, comment?}` market order |
| POST | `/positions/{id}/close` | Close a position at market |

Tradebot's own orders are marked with magic number `20261124` and a `TB …` comment. Order filling mode (FOK, IOC or RETURN) is chosen per symbol, retrying automatically if the broker rejects one.
