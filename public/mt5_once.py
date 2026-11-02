#!/usr/bin/env python3
"""One MetaTrader 5 ticket.

Windows only. The terminal must already be logged in. Exness is that login.
This does not run in Termux.

Default is paper: the gate runs, and order_send is not called.

  python mt5_once.py EURUSD buy 0.01 40 60
  PIP_LIVE=1 python mt5_once.py EURUSD buy 0.01 40 60 --live SEND

A kill file from `python pip.py kill` blocks the live path.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def desk():
    path = Path(__file__).resolve().with_name("pip.py")
    spec = importlib.util.spec_from_file_location("pip_desk", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("pip.py is missing beside this file")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main(argv: list[str]) -> int:
    args = [item for item in argv[1:] if item != "--live"]
    live_flag = "--live" in argv[1:]
    if len(args) != 5:
        print(__doc__)
        return 1
    symbol, side, lots_s, stop_s, target_s = args
    symbol = symbol.upper()
    side = side.lower()
    confirm = "SEND" if live_flag else ""
    lots = float(lots_s)
    stop_pips = float(stop_s)
    target_pips = float(target_s)
    if side not in ("buy", "sell"):
        print("Side must be buy or sell.")
        return 2
    if lots <= 0 or lots > 0.1:
        print("REFUSE  lots  this bridge sends at most 0.10 lot.")
        return 2
    if stop_pips <= 0 or target_pips <= 0:
        print("REFUSE  stop and target must be above zero.")
        return 2
    engine = desk()
    if engine.gate(symbol, "long" if side == "buy" else "short", stop_pips, 1000) != 0:
        return 2
    if not live_flag:
        print("PAPER  order_send was not called.")
        print(f"TICKET  {symbol} {side} {lots} lots  stop {stop_pips:g}  target {target_pips:g}")
        return 0
    blocked = engine.live_ready(confirm)
    if blocked:
        print(f"PAPER  {blocked}")
        return 0
    if engine.seen_recent(symbol):
        print(f"REFUSE  duplicate  {symbol} already filled in the last two minutes")
        return 2
    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("MetaTrader5 is not installed. On Windows: pip install MetaTrader5")
        print("A phone cannot import it. No order was sent.")
        return 2
    if not mt5.initialize():
        print(f"REFUSE  terminal  {mt5.last_error()}")
        return 2
    info = mt5.symbol_info(symbol)
    if info is None or not info.visible and not mt5.symbol_select(symbol, True):
        print(f"REFUSE  symbol  {symbol} is not in this terminal.")
        mt5.shutdown()
        return 2
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if info is None or tick is None:
        print("REFUSE  no tick. The market may be closed.")
        mt5.shutdown()
        return 2
    point = info.point or 0.00001
    pip = point * (10 if info.digits in (3, 5) else 1)
    price = tick.ask if side == "buy" else tick.bid
    spread_px = float(tick.ask) - float(tick.bid)
    stop_px = stop_pips * pip
    print(f"BOOK  bid {tick.bid}  ask {tick.ask}  spread {spread_px}")
    if stop_px <= 0 or spread_px / stop_px > 0.15:
        print("REFUSE  spread  the terminal bid and ask are more than 15% of the stop")
        mt5.shutdown()
        return 2
    direction = 1 if side == "buy" else -1
    order_type = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lots,
        "type": order_type,
        "price": price,
        "sl": round(price - direction * stop_pips * pip, info.digits),
        "tp": round(price + direction * target_pips * pip, info.digits),
        "deviation": 20,
        "magic": 870,
        "comment": "PiP once",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    result = mt5.order_send(request)
    mt5.shutdown()
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        code = None if result is None else result.retcode
        comment = "" if result is None else result.comment
        print(f"REFUSED  {code} {comment}")
        engine.remember(symbol, "rejected", False)
        return 2
    print(f"ACCEPTED  ticket {result.order}  {symbol} {side} {lots} lots")
    engine.remember(symbol, f"ticket {result.order}", True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
