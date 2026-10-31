# PiP

The desk is this website. Add it to the home screen from the browser. There is no Play Store app, and it is not a forecast.

The zone is yours to pick. Type any stake. The path uses the win rate you type, not a measured edge. Nothing here trades while you sleep.

## Phone (Termux)

```sh
pkg install python
git clone https://github.com/isgr870/PiP.git
cd PiP
python pip.py gate EURUSD long 25 300
python pip.py stake 250 0.5 25 1.5 45 40
```

On a Saturday the forex gate refuses before it talks about pips. Bitcoin does not.

One Binance spot buy, 5 to 250 USDT, then unset the keys:

```sh
export BINANCE_API_KEY=...
export BINANCE_API_SECRET=...
python pip.py binance 10
unset BINANCE_API_KEY BINANCE_API_SECRET
```

## MetaTrader and Exness

Those are the same terminal. On Windows, logged in:

```sh
pip install MetaTrader5
python mt5_once.py EURUSD buy 0.01 25 40
```

That file does not run on a phone.

## Desk

```sh
npm install
npm run dev
```
