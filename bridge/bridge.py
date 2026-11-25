"""Tradebot MT5 Bridge
=====================
A small REST server that runs on your own Windows PC/VPS next to the MetaTrader 5 terminal
and lets the Tradebot app read your account and place/close trades through MetaQuotes'
official `MetaTrader5` Python package. No third-party cloud involved.

* MT5 must be installed, logged in (tick "Save password") and "Algo Trading" enabled.
* Every request (except /health) needs the access key:  Authorization: Bearer <token>
* Settings live in config.json next to this file (created by install.ps1):
    {"token": "...", "port": 8787, "host": "127.0.0.1", "terminal_path": ""}

Run:  python bridge.py      (install.ps1 sets this up to start automatically)
"""
from __future__ import annotations

import functools
import hmac
import json
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import MetaTrader5 as mt5
import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

VERSION = "1.2.0"
BOT_MAGIC = 20261124          # magic number stamped on Tradebot's own orders
HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "config.json").read_text(encoding="utf-8")) if (HERE / "config.json").exists() else {}
TOKEN = os.environ.get("TRADEBOT_BRIDGE_TOKEN") or CONFIG.get("token", "")
if len(TOKEN) < 24:
    raise SystemExit("Access key missing or too short. Run install.ps1 (or set 'token' in config.json, 24+ chars).")

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler(HERE / "bridge.log", encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("bridge")

# The MetaTrader5 package is not thread-safe: serialise every call.
LOCK = threading.RLock()

TIMEFRAMES = {
    "1m": mt5.TIMEFRAME_M1, "5m": mt5.TIMEFRAME_M5, "15m": mt5.TIMEFRAME_M15, "30m": mt5.TIMEFRAME_M30,
    "1h": mt5.TIMEFRAME_H1, "4h": mt5.TIMEFRAME_H4, "1d": mt5.TIMEFRAME_D1,
}
OK_CODES = {mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_PLACED, mt5.TRADE_RETCODE_DONE_PARTIAL}
RETCODE_NAMES = {v: k for k, v in vars(mt5).items() if k.startswith("TRADE_RETCODE_") and isinstance(v, int)}


# --------------------------------------------------------------------------- MT5 connection
def ensure_mt5() -> None:
    """Attach to the running, logged-in terminal (re-attaching if the link dropped)."""
    info = mt5.terminal_info()
    if info is not None and info.connected and mt5.account_info() is not None:
        return
    mt5.shutdown()
    kwargs = {"timeout": 30000}
    if CONFIG.get("terminal_path"):
        kwargs["path"] = CONFIG["terminal_path"]
    if not mt5.initialize(**kwargs):
        raise HTTPException(503, f"Cannot attach to MetaTrader 5: {mt5.last_error()}. Is the terminal open and logged in?")
    info = mt5.terminal_info()
    if info is None or not info.connected:
        raise HTTPException(503, "MetaTrader 5 is not connected to the broker server.")
    if mt5.account_info() is None:
        raise HTTPException(503, "No trading account is logged in inside MetaTrader 5.")
    log.info("Attached to MT5 (%s, account %s)", info.name, mt5.account_info().login)


def mt5_call(fn):
    """Decorator: lock + ensure connection around a handler body."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        with LOCK:
            ensure_mt5()
            return fn(*a, **kw)
    return wrapper


def select_symbol(symbol: str):
    info = mt5.symbol_info(symbol)
    if info is None:
        raise HTTPException(404, f"Unknown symbol {symbol}")
    if not info.visible and not mt5.symbol_select(symbol, True):
        raise HTTPException(400, f"Cannot enable {symbol} in Market Watch")
    return mt5.symbol_info(symbol)


def tag_comment(comment: str, magic: int) -> str:
    # Some servers truncate/strip comments; keep bot trades recognisable via the magic number.
    if magic == BOT_MAGIC and not (comment or "").startswith("TB"):
        return "TB S"
    return comment or ""


# --------------------------------------------------------------------------- API
app = FastAPI(title="Tradebot MT5 Bridge", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])


def auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    supplied = header[7:] if header.lower().startswith("bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied.encode(), TOKEN.encode()):
        time.sleep(0.5)  # slow down guessing
        raise HTTPException(401, "Invalid access key")


@app.get("/health")
def health():
    return {"ok": True, "service": "tradebot-bridge", "version": VERSION}


@app.get("/status", dependencies=[Depends(auth)])
@mt5_call
def status():
    t, a = mt5.terminal_info(), mt5.account_info()
    return {"connected": bool(t.connected), "tradeAllowed": bool(t.trade_allowed), "terminal": t.name,
            "build": t.build, "login": a.login, "server": a.server, "company": a.company, "version": VERSION}


@app.get("/account", dependencies=[Depends(auth)])
@mt5_call
def account():
    a = mt5.account_info()
    return {"name": a.name, "login": a.login, "server": a.server, "currency": a.currency, "leverage": a.leverage,
            "balance": a.balance, "equity": a.equity, "margin": a.margin, "freeMargin": a.margin_free,
            "platform": "mt5", "tradeAllowed": bool(a.trade_allowed and mt5.terminal_info().trade_allowed)}


def position_dict(p) -> dict:
    return {"id": str(p.ticket), "symbol": p.symbol,
            "type": "POSITION_TYPE_BUY" if p.type == mt5.POSITION_TYPE_BUY else "POSITION_TYPE_SELL",
            "volume": p.volume, "openPrice": p.price_open, "currentPrice": p.price_current,
            "stopLoss": p.sl or None, "takeProfit": p.tp or None, "profit": p.profit + p.swap,
            "swap": p.swap, "time": int(p.time) * 1000, "magic": p.magic, "comment": tag_comment(p.comment, p.magic)}


@app.get("/positions", dependencies=[Depends(auth)])
@mt5_call
def positions():
    return [position_dict(p) for p in (mt5.positions_get() or [])]


@app.get("/history", dependencies=[Depends(auth)])
@mt5_call
def history(days: int = 30):
    end = datetime.now(timezone.utc) + timedelta(days=1)   # +1d covers broker server time offsets
    start = end - timedelta(days=max(1, min(days, 365)) + 1)
    out = []
    for d in mt5.history_deals_get(start, end) or []:
        if d.entry not in (mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY):
            continue
        out.append({"id": str(d.position_id), "symbol": d.symbol,
                    # closing deal of a BUY position is a SELL deal
                    "type": "POSITION_TYPE_BUY" if d.type == mt5.DEAL_TYPE_SELL else "POSITION_TYPE_SELL",
                    "volume": d.volume, "closePrice": d.price, "time": int(d.time) * 1000,
                    "profit": d.profit + d.commission + d.swap + getattr(d, "fee", 0.0),
                    "comment": tag_comment(d.comment, d.magic)})
    out.sort(key=lambda x: x["time"], reverse=True)
    return out


@app.get("/symbols", dependencies=[Depends(auth)])
@mt5_call
def symbols():
    allsyms = mt5.symbols_get() or []
    visible = [s.name for s in allsyms if s.visible]
    return visible + [s.name for s in allsyms if not s.visible]


@app.get("/symbols/catalog", dependencies=[Depends(auth)])
@mt5_call
def catalog():
    """All broker symbols with MT5's folder path (e.g. 'Forex\\Majors\\EURUSD') and description."""
    allsyms = mt5.symbols_get() or []
    rows = [{"name": s.name, "path": s.path, "desc": s.description, "visible": bool(s.visible)} for s in allsyms]
    rows.sort(key=lambda r: (not r["visible"], r["path"]))
    return rows


@app.get("/symbols/{symbol}/spec", dependencies=[Depends(auth)])
@mt5_call
def spec(symbol: str):
    s = select_symbol(symbol)
    return {"symbol": symbol, "digits": s.digits, "contractSize": s.trade_contract_size, "minVolume": s.volume_min,
            "maxVolume": s.volume_max, "volumeStep": s.volume_step, "point": s.point,
            "stopsLevel": s.trade_stops_level, "currencyProfit": s.currency_profit,
            # value of one tick for 1 lot, already in the account currency: exact P/L sizing for every symbol type
            "tickSize": s.trade_tick_size, "tickValue": s.trade_tick_value,
            "description": s.description, "path": s.path}


@app.get("/symbols/{symbol}/price", dependencies=[Depends(auth)])
@mt5_call
def price(symbol: str):
    select_symbol(symbol)
    t = mt5.symbol_info_tick(symbol)
    if t is None:
        raise HTTPException(503, f"No price for {symbol} (market closed?)")
    return {"symbol": symbol, "bid": t.bid, "ask": t.ask, "time": int(t.time) * 1000}


@app.get("/symbols/{symbol}/candles", dependencies=[Depends(auth)])
@mt5_call
def candles(symbol: str, timeframe: str = "15m", limit: int = 200):
    if timeframe not in TIMEFRAMES:
        raise HTTPException(400, f"timeframe must be one of {list(TIMEFRAMES)}")
    select_symbol(symbol)
    rates = mt5.copy_rates_from_pos(symbol, TIMEFRAMES[timeframe], 0, max(10, min(limit, 1000)))
    if rates is None:
        raise HTTPException(503, f"No candles for {symbol}: {mt5.last_error()}")
    return [{"time": int(r["time"]) * 1000, "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]),
             "close": float(r["close"]), "tickVolume": int(r["tick_volume"])} for r in rates]


class TradeIn(BaseModel):
    symbol: str
    side: str = Field(pattern="^(BUY|SELL)$")
    volume: float = Field(gt=0, le=100)
    stopLoss: Optional[float] = None
    takeProfit: Optional[float] = None
    comment: str = ""


def fill_modes(sym) -> list[int]:
    # symbol_info.filling_mode is a bit mask: 1 = FOK allowed, 2 = IOC allowed; RETURN is the fallback.
    modes = []
    if sym.filling_mode & 1: modes.append(mt5.ORDER_FILLING_FOK)
    if sym.filling_mode & 2: modes.append(mt5.ORDER_FILLING_IOC)
    modes.append(mt5.ORDER_FILLING_RETURN)
    return modes


def send(request: dict, sym) -> dict:
    last = None
    for mode in fill_modes(sym):
        request["type_filling"] = mode
        res = mt5.order_send(request)
        if res is None:
            raise HTTPException(502, f"order_send failed: {mt5.last_error()}")
        last = res
        if res.retcode != mt5.TRADE_RETCODE_INVALID_FILL:
            break
    code = RETCODE_NAMES.get(last.retcode, str(last.retcode))
    if last.retcode not in OK_CODES:
        raise HTTPException(400, f"{code}: {last.comment}")
    return {"stringCode": code, "orderId": str(last.order), "dealId": str(last.deal),
            "positionId": str(last.order), "price": last.price, "volume": last.volume}


@app.post("/trade", dependencies=[Depends(auth)])
@mt5_call
def trade(t: TradeIn):
    sym = select_symbol(t.symbol)
    tick = mt5.symbol_info_tick(t.symbol)
    if tick is None:
        raise HTTPException(503, f"No price for {t.symbol}")
    is_bot = t.comment.startswith("TB ")
    req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": t.symbol, "volume": float(t.volume),
           "type": mt5.ORDER_TYPE_BUY if t.side == "BUY" else mt5.ORDER_TYPE_SELL,
           "price": tick.ask if t.side == "BUY" else tick.bid, "deviation": 20,
           "magic": BOT_MAGIC if is_bot else 0, "comment": (t.comment or "Tradebot")[:31],
           "type_time": mt5.ORDER_TIME_GTC}
    if t.stopLoss: req["sl"] = round(float(t.stopLoss), sym.digits)
    if t.takeProfit: req["tp"] = round(float(t.takeProfit), sym.digits)
    result = send(req, sym)
    log.info("TRADE %s %s %s sl=%s tp=%s -> %s", t.side, t.volume, t.symbol, t.stopLoss, t.takeProfit, result["stringCode"])
    return result


class CloseIn(BaseModel):
    comment: str = ""


@app.post("/positions/{ticket}/close", dependencies=[Depends(auth)])
@mt5_call
def close(ticket: int, body: Optional[CloseIn] = None):
    found = mt5.positions_get(ticket=ticket)
    if not found:
        raise HTTPException(404, f"Position {ticket} not found (already closed?)")
    p = found[0]
    sym = select_symbol(p.symbol)
    tick = mt5.symbol_info_tick(p.symbol)
    is_buy = p.type == mt5.POSITION_TYPE_BUY
    req = {"action": mt5.TRADE_ACTION_DEAL, "symbol": p.symbol, "volume": p.volume, "position": p.ticket,
           "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY, "price": tick.bid if is_buy else tick.ask,
           "deviation": 20, "magic": p.magic, "comment": ((body.comment if body else "") or "Tradebot close")[:31],
           "type_time": mt5.ORDER_TIME_GTC}
    result = send(req, sym)
    log.info("CLOSE #%s %s %s -> %s", ticket, p.symbol, p.volume, result["stringCode"])
    return result


if __name__ == "__main__":
    host = CONFIG.get("host", "127.0.0.1")   # Caddy (HTTPS) forwards to this; keep it local
    port = int(CONFIG.get("port", 8787))
    log.info("Tradebot bridge %s listening on http://%s:%s", VERSION, host, port)
    uvicorn.run(app, host=host, port=port, log_level="warning")
