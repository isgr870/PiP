#!/usr/bin/env python3
"""PiP engine for Termux. Standard library only.

The numbers in this file are desk priors: a published EURUSD hourly range,
scaled guesses for other pairs, and a fixed spread table. They are not a live
book and not a forecast. The gate decides eligibility. It does not send.

Live orders stay off unless the kill file is absent, PIP_LIVE=1, PIP_SENDER is the person's name, and the word SEND is present. Bitcoin eligibility uses the live Binance book. Forex stays on the prior table until a broker feed exists.

  python pip.py book
  python pip.py binance 10 2000 1000
  PIP_SENDER=isagara PIP_LIVE=1 python pip.py binance 10 2000 1000 SEND
  python pip.py status 123456
  python pip.py cancel 123456 CANCEL
  python pip.py kill
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

EAT = timezone(timedelta(hours=3))
STATE = Path.home() / ".pip"
KILL = STATE / "KILL"
LOG = STATE / "orders.log"

# Typical hourly range in pips, UTC hour. EURUSD from the 2010–2026 study.
# Other pairs are enough to run the gate. They are not a forecast.
EURUSD_HOUR = [
    14, 13, 11, 10, 9, 11, 17, 22, 22, 20, 18, 18,
    25, 27, 28, 24, 19, 16, 16, 14, 11, 8, 8, 9,
]

SPREAD = {
    "EURUSD": 1.0,
    "GBPUSD": 1.3,
    "USDJPY": 1.1,
    "USDCHF": 1.4,
    "AUDUSD": 1.2,
    "USDCAD": 1.5,
    "NZDUSD": 1.8,
    "EURJPY": 1.8,
    "XAUUSD": 35.0,
    "BTCUSD": 30.0,
}

SESSION_PAIRS = {
    "tokyo": {"USDJPY", "AUDUSD", "NZDUSD", "EURJPY"},
    "london": {"EURUSD", "GBPUSD", "USDCHF", "EURJPY", "XAUUSD"},
    "overlap": {"EURUSD", "GBPUSD", "USDJPY", "USDCAD", "XAUUSD", "BTCUSD"},
    "newyork": {"BTCUSD"},
    "late": set(),
}

FACTORS = {
    "EURUSD": (-0.72, 0.35),
    "GBPUSD": (-0.68, 0.55),
    "AUDUSD": (-0.58, 0.70),
    "NZDUSD": (-0.52, 0.62),
    "USDJPY": (0.48, -0.45),
    "USDCHF": (0.55, -0.40),
    "USDCAD": (0.42, -0.15),
    "EURJPY": (-0.22, 0.15),
    "XAUUSD": (-0.40, -0.25),
    "BTCUSD": (-0.30, 1.40),
}


def fx_closed(now: datetime) -> bool:
    # Monday is 0. Friday from 22:00 UTC, all Saturday, Sunday before 22:00 UTC.
    if now.weekday() == 5:
        return True
    if now.weekday() == 6 and now.hour < 22:
        return True
    if now.weekday() == 4 and now.hour >= 22:
        return True
    return False


def session_of(hour: int) -> str:
    if hour < 7:
        return "tokyo"
    if hour < 12:
        return "london"
    if hour < 16:
        return "overlap"
    if hour < 21:
        return "newyork"
    return "late"


def spread_mult(hour: int) -> float:
    if 12 <= hour < 16:
        return 0.85
    if 7 <= hour < 12:
        return 1.0
    if 0 <= hour < 7:
        return 1.35
    if 16 <= hour < 21:
        return 1.1
    return 1.75


def noise_pips(pair: str, hour: int) -> float:
    if pair == "BTCUSD":
        return {"tokyo": 400, "london": 500, "overlap": 900, "newyork": 800, "late": 350}[session_of(hour)]
    if pair == "XAUUSD":
        # Dollars of range, expressed in $0.01 pips.
        dollars = {"tokyo": 4, "london": 5, "overlap": 8, "newyork": 5, "late": 3}[session_of(hour)]
        return dollars / 0.01
    base = EURUSD_HOUR[hour]
    scale = {"GBPUSD": 1.2, "USDJPY": 0.95, "EURJPY": 1.15}.get(pair, 1.0)
    return base * scale


def gate(pair: str, side: str, stop: float, equity: float, risk_pct: float = 0.005) -> int:
    now = datetime.now(timezone.utc)
    hour = now.hour
    sess = session_of(hour)
    eat = now.astimezone(EAT)
    print(f"PiP  {now:%a %H:%M} UTC  {sess}")
    print(f"{pair} {side}  stop {stop:g}  equity ${equity:,.0f}")
    if pair != "BTCUSD" and fx_closed(now):
        print("REFUSE  market  spot forex is closed until Sunday 22:00 UTC")
        print("VERDICT  refuse")
        print("No order. Write the reason in a notebook anyway.")
        return 2
    hard = False
    soft = False
    allowed = pair in SESSION_PAIRS[sess]
    print(("PASS" if allowed else "REFUSE") + f"  session  {pair} {'is' if allowed else 'is not'} on the {sess} list")
    hard = hard or not allowed
    noise = noise_pips(pair, hour)
    stop_ok = stop >= noise * 1.5
    print(("PASS" if stop_ok else "REFUSE") + f"  noise  typical hour {noise:.0f}, stop {stop:.0f}")
    hard = hard or not stop_ok
    spread = SPREAD.get(pair, 1.5) * spread_mult(hour)
    share = spread / stop if stop else 1
    spread_ok = share <= 0.15
    print(("PASS" if spread_ok else "REFUSE") + f"  spread  {share * 100:.0f}% of the stop (line is 15%)")
    hard = hard or not spread_ok
    usd, risk = FACTORS.get(pair, (0.0, 0.0))
    direction = 1 if side == "long" else -1
    print("NOTE   news  phone has no calendar in this file. If a red print is inside 15 minutes, the answer is no.")
    if hard:
        print("VERDICT  refuse")
        print("No order. Write the reason in a notebook anyway.")
        return 2
    if soft:
        risk_pct *= 0.5
        print("VERDICT  cut  size halved")
    else:
        print("VERDICT  allow  still not a promise")
    risk_usd = equity * risk_pct
    print(f"Risk ${risk_usd:.2f} at {risk_pct * 100:.2f}%")
    for name, u, r in (
        ("dollar +0.6%", 0.006, 0.0),
        ("risk off 1%", 0.0, -0.01),
        ("both", 0.006, -0.008),
    ):
        # Rough: treat notional as equity * 3 so the shock is readable on a small book.
        notional = equity * 3
        pnl = notional * direction * (usd * u + risk * r)
        print(f"  {name:16} {pnl:+.2f} USD on a 3× notional sketch")
    return 0


def stake(amount: float, risk_pct: float, stop: float, target_r: float, win_rate: float, trades: int) -> int:
    """risk_pct is a percent, win_rate is a fraction or a percent above 1."""
    if win_rate > 1:
        win_rate = win_rate / 100
    risk = amount * (risk_pct / 100)
    spread_share = 1.0 / stop if stop else 1
    spread_usd = risk * spread_share
    reward = risk * target_r
    expectancy = win_rate * reward - (1 - win_rate) * risk - spread_usd
    print(f"PiP stake ${amount:,.2f}")
    print(f"Risk ${risk:.2f}  target ${reward:.2f}  spread about ${spread_usd:.2f}")
    print(f"Assumed win rate {win_rate * 100:.1f}% over {trades} trades")
    print(f"Expectancy per trade ${expectancy:.2f}")
    if spread_share > 0.15:
        print("REFUSE  spread is more than 15% of the stop. The broker is the strategy.")
    elif expectancy < 0:
        print("REFUSE  at this win rate the path loses after the spread.")
    else:
        print("NOTE  expectancy is positive only if your win rate is real. PiP did not measure it.")
    print("No order was sent.")
    return 0


def killed() -> bool:
    return os.environ.get("PIP_KILL") == "1" or KILL.exists()


def live_ready(confirm: str) -> str | None:
    if killed():
        return "Kill switch is on. Run python pip.py arm to remove the file. No order was sent."
    if os.environ.get("PIP_LIVE") != "1":
        return "PIP_LIVE is not 1. Paper only. No order was sent."
    sender = os.environ.get("PIP_SENDER", "").strip()
    if not sender:
        return "Set PIP_SENDER to the name of the person sending. No order was sent."
    if confirm != "SEND":
        return "Live orders require the word SEND. No order was sent."
    return None


def seen_recent(symbol: str, window: int = 120) -> bool:
    if not LOG.exists():
        return False
    cutoff = datetime.now(timezone.utc).timestamp() - window
    for line in LOG.read_text(encoding="utf-8").splitlines()[-40:]:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("symbol") == symbol and row.get("kind") == "order" and row.get("ok") and float(row.get("ts", 0)) >= cutoff:
            return True
    return False


def remember(symbol: str, detail: str, ok: bool, **extra: object) -> None:
    STATE.mkdir(exist_ok=True)
    row = {
        "ts": datetime.now(timezone.utc).timestamp(),
        "symbol": symbol,
        "ok": ok,
        "detail": detail,
        "sender": os.environ.get("PIP_SENDER", "").strip(),
    }
    row.update(extra)
    with LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")


def public_json(host: str, path: str) -> dict | list:
    request = urllib.request.Request(host + path, headers={"User-Agent": "pip"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            message = json.loads(raw).get("msg", "refused")
        except json.JSONDecodeError:
            message = "refused"
        raise RuntimeError(message) from err


def observe_btc(host: str = "https://data-api.binance.vision") -> dict[str, float]:
    book = public_json(host, "/api/v3/ticker/bookTicker?symbol=BTCUSDT")
    bars = public_json(host, "/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60")
    if not isinstance(book, dict) or not isinstance(bars, list) or not bars:
        raise RuntimeError("empty book")
    bid = float(book["bidPrice"])
    ask = float(book["askPrice"])
    highs = [float(row[2]) for row in bars]
    lows = [float(row[3]) for row in bars]
    return {"bid": bid, "ask": ask, "spread": ask - bid, "hour": max(highs) - min(lows)}


def print_book(obs: dict[str, float]) -> None:
    print(f"BOOK  bid {obs['bid']:.2f}  ask {obs['ask']:.2f}  spread {obs['spread']:.2f} USDT")
    print(f"BOOK  last hour {obs['hour']:.2f} USDT  live tape, not a prior")


def live_btc_gate(stop: float) -> dict[str, float] | None:
    try:
        obs = observe_btc()
    except (urllib.error.URLError, KeyError, ValueError, RuntimeError, TimeoutError) as err:
        print(f"REFUSE  book  {err}")
        return None
    print_book(obs)
    if obs["spread"] <= 0 or obs["hour"] <= 0 or stop <= 0:
        print("REFUSE  book  the tape was empty")
        return None
    if stop < obs["hour"] * 1.5:
        print(f"REFUSE  noise  stop {stop:g} is inside an hour of {obs['hour']:.0f} USDT")
        return None
    if obs["spread"] / stop > 0.15:
        print("REFUSE  spread  the live spread is more than 15% of the stop")
        return None
    print("PASS  live book")
    return obs


def floor_to_step(value: float, step: float) -> str:
    if step <= 0:
        raise RuntimeError("bad step")
    count = int(value / step)
    places = max(0, len(f"{step:.12f}".rstrip("0").split(".")[-1]) if "." in f"{step:.12f}" else 0)
    return f"{count * step:.{places}f}"


def btc_filters(host: str) -> dict[str, float]:
    info = public_json(host, "/api/v3/exchangeInfo?symbol=BTCUSDT")
    if not isinstance(info, dict):
        raise RuntimeError("no filters")
    filters = {item["filterType"]: item for item in info["symbols"][0]["filters"]}
    return {
        "step": float(filters["LOT_SIZE"]["stepSize"]),
        "tick": float(filters["PRICE_FILTER"]["tickSize"]),
        "min_qty": float(filters["LOT_SIZE"]["minQty"]),
    }


def binance_buy(quote: float, stop: float, equity: float, confirm: str) -> int:
    print(f"PiP  Binance check  {quote:.2f} USDT  stop {stop:g} USDT  typed equity ${equity:,.0f}")
    if quote < 5 or quote > 250:
        print("REFUSE  size  one order must be between 5 and 250 USDT")
        return 2
    if equity <= 0 or quote > equity * 0.01:
        print("REFUSE  size  the order is above 1% of the equity you typed")
        return 2
    if live_btc_gate(stop) is None:
        return 2
    blocked = live_ready(confirm)
    if blocked:
        print(f"PAPER  {blocked}")
        remember("BTCUSDT", "paper", False, quote=quote)
        return 0
    if seen_recent("BTCUSDT"):
        print("REFUSE  duplicate  BTCUSDT already sent in the last two minutes")
        return 2
    key = os.environ.get("BINANCE_API_KEY", "").strip()
    secret = os.environ.get("BINANCE_API_SECRET", "").strip()
    if len(key) < 16 or len(secret) < 16:
        print("REFUSE  keys  export BINANCE_API_KEY and BINANCE_API_SECRET, then unset them")
        return 2
    mainnet = os.environ.get("PIP_BINANCE_MAINNET") == "1"
    host = "https://api.binance.com" if mainnet else "https://testnet.binance.vision"
    print("ROUTE  mainnet" if mainnet else "ROUTE  testnet")
    account = signed_request(host, "/api/v3/account", key, secret, {})
    if account is None:
        return 2
    free = usdt_free(account)
    held = asset_free(account, "BTC")
    print(f"ACCOUNT  free USDT {free}  free BTC {held}")
    if free is None or free < quote or quote > free * 0.01:
        print("REFUSE  account  free USDT is the ceiling, and the typed equity cannot raise it")
        remember("BTCUSDT", "account short", False)
        return 2
    try:
        price_host = host if not mainnet else "https://data-api.binance.vision"
        route = observe_btc(price_host)
        rules = btc_filters(price_host)
        price = floor_to_step(route["bid"], rules["tick"])
        qty = floor_to_step(quote / float(price), rules["step"])
    except (urllib.error.URLError, KeyError, ValueError, RuntimeError, TimeoutError):
        print("REFUSE  book  the route had no bid to join")
        return 2
    if float(qty) < rules["min_qty"] or float(qty) * float(price) < 5:
        print("REFUSE  size  the limit quantity rounded below the exchange minimum")
        return 2
    order = signed_request(
        host,
        "/api/v3/order",
        key,
        secret,
        {"symbol": "BTCUSDT", "side": "BUY", "type": "LIMIT", "timeInForce": "GTC", "quantity": qty, "price": price},
        method="POST",
    )
    if order is None:
        remember("BTCUSDT", "rejected", False, quote=quote)
        return 2
    order_id = order.get("orderId")
    status = order.get("status")
    filled = order.get("executedQty")
    print(f"ACCEPTED  limit {order_id}  status {status}  filled {filled}  price {price}")
    print("A resting limit can be cancelled. A market order cannot. This one rests on the bid.")
    remember("BTCUSDT", f"order {order_id}", True, kind="order", orderId=order_id, status=status, filled=filled, quote=quote)
    return 0


def binance_status(order_id: str) -> int:
    key = os.environ.get("BINANCE_API_KEY", "").strip()
    secret = os.environ.get("BINANCE_API_SECRET", "").strip()
    if len(key) < 16 or len(secret) < 16:
        print("REFUSE  keys  status needs the same key that sent the order")
        return 2
    host = "https://api.binance.com" if os.environ.get("PIP_BINANCE_MAINNET") == "1" else "https://testnet.binance.vision"
    order = signed_request(host, "/api/v3/order", key, secret, {"symbol": "BTCUSDT", "orderId": order_id})
    if order is None:
        return 2
    print(f"STATUS  {order.get('orderId')}  {order.get('status')}  filled {order.get('executedQty')} of {order.get('origQty')}  price {order.get('price')}")
    remember("BTCUSDT", "status", True, orderId=order.get("orderId"), status=order.get("status"), filled=order.get("executedQty"))
    return 0


def binance_cancel(order_id: str, confirm: str) -> int:
    if confirm != "CANCEL":
        print("REFUSE  cancel requires the word CANCEL")
        return 2
    if killed():
        print("Kill switch is on. This cancel is still sent, because a kill stops new risk and must not trap a resting order.")
    key = os.environ.get("BINANCE_API_KEY", "").strip()
    secret = os.environ.get("BINANCE_API_SECRET", "").strip()
    if len(key) < 16 or len(secret) < 16:
        print("REFUSE  keys")
        return 2
    host = "https://api.binance.com" if os.environ.get("PIP_BINANCE_MAINNET") == "1" else "https://testnet.binance.vision"
    order = signed_request(host, "/api/v3/order", key, secret, {"symbol": "BTCUSDT", "orderId": order_id}, method="DELETE")
    if order is None:
        return 2
    print(f"CANCELLED  {order.get('orderId')}  status {order.get('status')}")
    remember("BTCUSDT", "cancel", True, orderId=order.get("orderId"), status=order.get("status"))
    return 0


def asset_free(account: dict, asset: str) -> float | None:
    for row in account.get("balances") or []:
        if row.get("asset") == asset:
            try:
                return float(row.get("free", 0))
            except (TypeError, ValueError):
                return None
    return None


def usdt_free(account: dict) -> float | None:
    return asset_free(account, "USDT")


def signed_request(host: str, path: str, key: str, secret: str, fields: dict, method: str = "GET") -> dict | None:
    params = dict(fields)
    params["recvWindow"] = "5000"
    params["timestamp"] = str(int(datetime.now(timezone.utc).timestamp() * 1000))
    query = urllib.parse.urlencode(params)
    signature = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    url = f"{host}{path}?{query}&signature={signature}"
    request = urllib.request.Request(url, method=method, headers={"X-MBX-APIKEY": key})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            message = json.loads(raw).get("msg", "refused")
        except json.JSONDecodeError:
            message = "refused"
        print(f"REFUSED  {message}")
        return None
    except urllib.error.URLError:
        print("REFUSED  the exchange did not answer. No fill was confirmed.")
        return None


def main(argv: list[str]) -> int:
    if len(argv) == 1:
        return gate("EURUSD", "long", 25, 300)
    if argv[1] == "gate" and len(argv) >= 6:
        return gate(argv[2].upper(), argv[3].lower(), float(argv[4]), float(argv[5]))
    if argv[1] == "stake" and len(argv) >= 8:
        return stake(float(argv[2]), float(argv[3]), float(argv[4]), float(argv[5]), float(argv[6]), int(argv[7]))
    if argv[1] == "kill":
        STATE.mkdir(exist_ok=True)
        KILL.write_text("on\n", encoding="utf-8")
        print("Kill switch on. No execution path will send.")
        return 0
    if argv[1] == "arm":
        if KILL.exists():
            KILL.unlink()
        print("Kill file removed. Live still needs PIP_LIVE=1 and the word SEND.")
        return 0
    if argv[1] == "book":
        try:
            print_book(observe_btc())
        except (urllib.error.URLError, KeyError, ValueError, RuntimeError, TimeoutError):
            print("REFUSE  book  Binance did not answer")
            return 2
        return 0
    if argv[1] == "binance" and len(argv) >= 5:
        confirm = argv[5].upper() if len(argv) >= 6 else ""
        return binance_buy(float(argv[2]), float(argv[3]), float(argv[4]), confirm)
    if argv[1] == "status" and len(argv) >= 3:
        return binance_status(argv[2])
    if argv[1] == "cancel" and len(argv) >= 3:
        confirm = argv[3].upper() if len(argv) >= 4 else ""
        return binance_cancel(argv[2], confirm)
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
