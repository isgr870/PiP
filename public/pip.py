#!/usr/bin/env python3
"""PiP engine for Termux. Standard library only.

Same gates as the desk: session, noise, spread, and whether the cash market is open.
One Binance spot buy is possible. MetaTrader is a separate file, mt5_once.py, and only on Windows.

  python pip.py
  python pip.py gate EURUSD long 25 300
  python pip.py gate BTCUSD long 1000 300
  python pip.py stake 250 0.5 25 1.5 45 40
  BINANCE_API_KEY=... BINANCE_API_SECRET=... python pip.py binance 10
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

EAT = timezone(timedelta(hours=3))

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


def binance_buy(quote: float) -> int:
    key = os.environ.get("BINANCE_API_KEY", "").strip()
    secret = os.environ.get("BINANCE_API_SECRET", "").strip()
    print(f"PiP  Binance spot BUY  {quote:.2f} USDT of BTCUSDT")
    if quote < 5 or quote > 250:
        print("REFUSE  size  one order must be between 5 and 250 USDT")
        return 2
    if len(key) < 16 or len(secret) < 16:
        print("No order. Export BINANCE_API_KEY and BINANCE_API_SECRET, run this once, then unset them.")
        print("Do not put the secret after the command. It would sit in the shell history.")
        return 2
    params = {
        "symbol": "BTCUSDT",
        "side": "BUY",
        "type": "MARKET",
        "quoteOrderQty": f"{quote:.2f}",
        "recvWindow": "5000",
        "timestamp": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
    }
    query = urllib.parse.urlencode(params)
    signature = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        "https://api.binance.com/api/v3/order?" + query + "&signature=" + signature,
        method="POST",
        headers={"X-MBX-APIKEY": key},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            message = json.loads(raw).get("msg", raw)
        except json.JSONDecodeError:
            message = raw
        print(f"REFUSED  {message}")
        return 2
    except urllib.error.URLError:
        print("REFUSED  Binance did not answer. No fill was confirmed.")
        return 2
    print(f"ACCEPTED  order {body.get('orderId')}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 1:
        return gate("EURUSD", "long", 25, 300)
    if argv[1] == "gate" and len(argv) >= 6:
        return gate(argv[2].upper(), argv[3].lower(), float(argv[4]), float(argv[5]))
    if argv[1] == "stake" and len(argv) >= 8:
        return stake(float(argv[2]), float(argv[3]), float(argv[4]), float(argv[5]), float(argv[6]), int(argv[7]))
    if argv[1] == "binance" and len(argv) >= 3:
        return binance_buy(float(argv[2]))
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
