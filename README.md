# PiP

A risk desk for one person. Not a Wall Street system, and not ready to replace one.

Bitcoin eligibility is the live Binance book: bid, ask, and the last hour of trades. Forex still uses the prior table in `pip.py`, because this desk has no forex feed. A prior is not a price.

Progression, in order:

1. `python pip.py book` reads the live BTC book and sends nothing.
2. `python pip.py binance 10 2000 1000` runs that book against your stop. Paper. Nothing is sent.
3. A live order is a limit buy sitting on the bid, so it can be cancelled. It needs the kill file absent, `PIP_LIVE=1`, `PIP_SENDER` set to a name, and the word `SEND`. The account's free USDT is the size ceiling. Testnet unless `PIP_BINANCE_MAINNET=1`.
4. `python pip.py status ORDERID` matches the order to a fill. `python pip.py cancel ORDERID CANCEL` pulls it.
5. `~/.pip/orders.log` keeps the sender, the order id, and the result. It does not keep the secret. `python pip.py kill` stops new sends.

The website does the same for BTC. It will not send unless the server itself has `PIP_SENDER` set to the same name, and mainnet also needs `PIP_LIVE=1`.

```sh
python pip.py book
python pip.py binance 10 2000 1000
python pip.py gate EURUSD long 25 300
```
