#!/usr/bin/env python3
"""One MetaTrader 5 market order, then stop.

Windows only. MetaTrader 5 must already be open and logged in.
Exness is that login: there is no separate Exness socket.
This file does not run in Termux.

  pip install MetaTrader5
  python mt5_once.py EURUSD buy 0.01 25 40

Arguments: symbol  buy|sell  lots  stop_pips  target_pips
"""

from __future__ import annotations

import sys


def main(argv: list[str]) -> int:
    if len(argv) != 6:
        print(__doc__)
        return 1
    symbol = argv[1].upper()
    side = argv[2].lower()
    lots = float(argv[3])
    stop_pips = float(argv[4])
    target_pips = float(argv[5])
    if side not in ("buy", "sell"):
        print("Side must be buy or sell.")
        return 2
    if lots <= 0 or lots > 1:
        print("REFUSE  lots  this bridge sends at most 1.0 lot, once.")
        return 2
    if stop_pips <= 0 or target_pips <= 0:
        print("REFUSE  stop and target must be above zero.")
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
    if info is None or not mt5.symbol_select(symbol, True):
        print(f"REFUSE  symbol  {symbol} is not in this terminal.")
        mt5.shutdown()
        return 2
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        print("REFUSE  no tick. The market may be closed.")
        mt5.shutdown()
        return 2
    point = info.point or 0.00001
    pip = point * (10 if info.digits in (3, 5) else 1)
    price = tick.ask if side == "buy" else tick.bid
    direction = 1 if side == "buy" else -1
    sl = price - direction * stop_pips * pip
    tp = price + direction * target_pips * pip
    order_type = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lots,
        "type": order_type,
        "price": price,
        "sl": round(sl, info.digits),
        "tp": round(tp, info.digits),
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
        return 2
    print(f"ACCEPTED  ticket {result.order}  {symbol} {side} {lots} lots")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
