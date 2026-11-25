# Tradebot MT5 Bridge

Runs on your own Windows PC or VPS next to MetaTrader 5 and lets the Tradebot app trade through MetaQuotes' official `MetaTrader5` Python package. It's free, and your MT5 password stays on your machine.

**Install (Administrator PowerShell on the VPS):**

```powershell
iwr https://raw.githubusercontent.com/dnzryts/Tradebot/main/bridge/install.ps1 -OutFile $env:TEMP\tb.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\tb.ps1
```

Full guide, security notes, troubleshooting and API reference: [docs/VPS_BRIDGE.md](../docs/VPS_BRIDGE.md)

| File | Purpose |
|---|---|
| `bridge.py` | FastAPI server (token auth, MT5 calls serialised with a lock) |
| `install.ps1` | One-command Windows installer: Python, packages, access key, Caddy HTTPS, firewall, auto-start |
| `requirements.txt` | `MetaTrader5`, `fastapi`, `uvicorn` |
