import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  ANALYZED,
  bookShocks,
  currenciesOf,
  instrumentName,
  judge,
  nearestEvents,
  projectStake,
  rollTicket,
  suggestedStop,
  type AnalyzedId,
  type CalEvent,
} from "@/lib/fx/analysis";
import { loadBinancePublic, loadDeskContext, sendBinanceSpot, type DeskContext } from "@/lib/fx/context";
import { realNotional, type Position } from "@/lib/fx/model";
import { HOURLY_PIPS, PAIRS, formatZone, zoneClock, signedUsd, usd, type PairId } from "@/lib/fx/research";
import { useDesk } from "@/lib/fx/store";
import { cn } from "@/lib/cn";

function tone(n: number): string {
  if (n > 0.004) return "text-up";
  if (n < -0.004) return "text-down";
  return "text-muted";
}

function isFx(id: AnalyzedId): id is PairId {
  return id in PAIRS;
}

function zoneStamp(iso: string, zone: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return formatZone(new Date(t), zone, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function HourProfile({ pair, hour, zone, now }: { pair: PairId; hour: number; zone: string; now: Date }) {
  const data = HOURLY_PIPS[pair].map((pips, index) => ({
    hour: index,
    label: zoneClock(index * 60, zone, now),
    pips,
  }));
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="label"
            interval={2}
            tick={{ fill: "var(--color-subtle)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "transparent" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as { label: string; pips: number } | undefined;
              if (!row) return null;
              return (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
                  <p className="font-mono text-fg">{row.label}</p>
                  <p className="text-muted">{row.pips} pips, average hour</p>
                </div>
              );
            }}
          />
          <Bar dataKey="pips" isAnimationActive={false} radius={2}>
            {data.map((row) => (
              <Cell key={row.hour} fill={row.hour === hour ? "var(--color-accent)" : "var(--color-muted)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AnalysisBoard({
  equity,
  cent,
  risk: _risk,
  positions,
  mids,
  minute,
}: {
  equity: number;
  cent: boolean;
  risk: string;
  positions: Position[];
  mids: Record<PairId, number>;
  minute: number;
}) {
  const record = useDesk((s) => s.record);
  const journal = useDesk((s) => s.journal);
  const clearJournal = useDesk((s) => s.clearJournal);
  const zone = useDesk((s) => s.zone) || "Africa/Kampala";
  const venue = useDesk((s) => s.venue);
  const setVenue = useDesk((s) => s.setVenue);
  const load = useServerFn(loadDeskContext);
  const pingBinance = useServerFn(loadBinancePublic);
  const sendSpot = useServerFn(sendBinanceSpot);
  const [ctx, setCtx] = useState<DeskContext | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [pair, setPair] = useState<AnalyzedId>("EURUSD");
  const [side, setSide] = useState<"long" | "short">("long");
  const [stopPips, setStopPips] = useState(25);
  const [reason, setReason] = useState("");
  const [written, setWritten] = useState("");
  const [stakeText, setStakeText] = useState(String(equity));
  const [riskPct, setRiskPct] = useState(0.5);
  const [targetR, setTargetR] = useState(1.5);
  const [winPct, setWinPct] = useState(45);
  const [tradeCount, setTradeCount] = useState(40);
  const [roll, setRoll] = useState<{ win: boolean; pnl: number } | null>(null);
  const [binance, setBinance] = useState<string>("Public book not read.");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [quoteText, setQuoteText] = useState("10");
  const [confirm, setConfirm] = useState("");
  const [serverName, setServerName] = useState("");
  const [login, setLogin] = useState("");

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    void load()
      .then((value) => {
        if (live) setCtx(value);
      })
      .catch(() => {
        if (live) setCtx({ asOf: null, offline: true, quotes: [], events: [] });
      });
    return () => {
      live = false;
    };
  }, [load]);

  const minuteUtc = now ? now.getUTCHours() * 60 + now.getUTCMinutes() : minute;
  const hour = Math.floor((((minuteUtc % 1440) + 1440) % 1440) / 60);
  const events: CalEvent[] = ctx?.events ?? [];
  const quote = ctx?.quotes.find((row) => row.pair === pair)?.mid;
  const stake = Number(stakeText);
  const stakeOk = Number.isFinite(stake) && stake > 0;

  useEffect(() => {
    setStopPips(suggestedStop(pair, minuteUtc));
  }, [pair, hour]);

  const verdict = useMemo(
    () =>
      judge(
        {
          pair,
          side,
          stopPips,
          equity: stakeOk ? stake : equity,
          cent: cent && isFx(pair),
          riskPct: Math.max(0, riskPct) / 100,
          minuteUtc,
          events,
          held: positions.map((pos) => ({ pair: pos.pair, side: pos.side })),
          calendarOnline: Boolean(ctx && ctx.events.length > 0),
        },
        quote,
      ),
    [pair, side, stopPips, stake, stakeOk, equity, cent, riskPct, minuteUtc, events, positions, ctx, quote],
  );

  const projection = useMemo(
    () =>
      projectStake({
        stake: stakeOk ? stake : equity,
        riskPct: Math.max(0, riskPct) / 100,
        targetR,
        spreadShare: verdict.spreadShare,
        winRate: winPct / 100,
        trades: tradeCount,
        seed: 0x504950,
      }),
    [stake, stakeOk, equity, riskPct, targetR, verdict.spreadShare, winPct, tradeCount],
  );

  const shocks = bookShocks(
    positions.map((pos) => ({
      pair: pos.pair,
      side: pos.side,
      notional: realNotional(pos, mids, cent),
    })),
  );

  const upcoming = nearestEvents(events);
  const statusLabel = verdict.status === "allow" ? "Allowed" : verdict.status === "cut" ? "Cut in half" : "Refused";
  const stopLabel = pair === "BTCUSD" ? "Stop distance, dollars" : pair === "XAUUSD" ? "Stop, cents of price × 100" : "Stop, pips";

  function write() {
    const line = verdict.clauses.map((clause) => `${clause.pass ? "pass" : "fail"} ${clause.gate}`).join(" · ");
    record({
      pair,
      side,
      stopPips,
      verdict: verdict.status,
      reason: reason.trim(),
      line,
    });
    setWritten(reason.trim());
    setReason("");
  }

  return (
    <section className="rounded-xl bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Constraint engine</p>
          <h2 className="font-serif text-2xl leading-tight">Should this trade exist?</h2>
        </div>
        <p className={cn("font-serif text-2xl", verdict.status === "refuse" ? "text-down" : verdict.status === "allow" ? "text-up" : "text-fg")}>
          {statusLabel}
        </p>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-muted">
        Aladdin prices whether a position fits a very large book. PiP prices one ticket, for any stake, in any city: the hour, the spread, the news, and the path if the win rate you type is actually true. The loadings are desk priors, not BlackRock’s covariance. A green path is not a wage. Refusal is still the product.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-muted">
          Market
          <select
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 text-fg"
            value={pair}
            onChange={(event) => setPair(event.target.value as AnalyzedId)}
          >
            {ANALYZED.map((id) => (
              <option key={id} value={id}>
                {id} · {instrumentName(id)}
              </option>
            ))}
          </select>
        </label>
        <div>
          <p className="text-sm text-muted">Side</p>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Side">
            {(["long", "short"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={side === value}
                onClick={() => setSide(value)}
                className={cn("press h-11 rounded-sm text-sm", side === value ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm text-muted sm:col-span-2">
          Stake under test, USD
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="decimal"
            value={stakeText}
            onChange={(event) => setStakeText(event.target.value)}
          />
        </label>
        <label className="block text-sm text-muted">
          Risk, percent of stake
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="decimal"
            value={riskPct}
            onChange={(event) => setRiskPct(Number(event.target.value))}
          />
        </label>
        <label className="block text-sm text-muted">
          Target, R
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="decimal"
            value={targetR}
            onChange={(event) => setTargetR(Number(event.target.value))}
          />
        </label>
        <label className="block text-sm text-muted">
          {stopLabel}
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="decimal"
            value={stopPips}
            onChange={(event) => setStopPips(Number(event.target.value))}
          />
        </label>
      </div>

      <ul className="mt-4">
        {verdict.clauses.map((clause) => (
          <li key={clause.gate} className="grid grid-cols-[5.5rem_1fr] gap-3 border-t border-border py-3">
            <p className={cn("text-sm", clause.pass ? "text-up" : "text-down")}>{clause.pass ? "Pass" : "Fail"}</p>
            <p className="text-sm">
              <span className="text-fg">{clause.gate}. </span>
              <span className="text-muted">{clause.text}</span>
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted">Risk if taken</p>
          <p className="font-mono text-lg tabular-nums">{usd(verdict.riskUsd)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Spread share of stop</p>
          <p className="font-mono text-lg tabular-nums">{(verdict.spreadShare * 100).toFixed(0)}%</p>
        </div>
        <div>
          <p className="text-sm text-muted">Notional</p>
          <p className="font-mono text-lg tabular-nums">{verdict.notional === null ? "—" : usd(verdict.notional)}</p>
        </div>
      </div>

      <h3 className="mt-5 font-serif text-xl">What this stake becomes</h3>
      <p className="mt-1 text-sm text-muted">The win rate is yours to type. PiP does not know it. Forty paths, four hundred draws.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-muted">
          Assumed win rate, percent
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="decimal"
            value={winPct}
            onChange={(event) => setWinPct(Number(event.target.value))}
          />
        </label>
        <label className="block text-sm text-muted">
          Trades in the path
          <input
            className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
            inputMode="numeric"
            value={tradeCount}
            onChange={(event) => setTradeCount(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted">Expectancy, one trade</p>
          <p className={cn("font-mono text-lg tabular-nums", tone(projection.expectancyUsd))}>{signedUsd(projection.expectancyUsd)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Spread, each fill</p>
          <p className="font-mono text-lg tabular-nums">{usd(projection.spreadUsd)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Paths cut in half</p>
          <p className="font-mono text-lg tabular-nums">{(projection.ruin * 100).toFixed(0)}%</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted">
        After {Math.min(200, Math.max(1, Math.round(tradeCount) || 1))} trades the book lands near {usd(projection.p10)} in a bad tenth, {usd(projection.p50)} in the middle, {usd(projection.p90)} in a good tenth. Started from {usd(stakeOk ? stake : equity)}.
      </p>
      <p className="mt-2 text-sm">{projection.note}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setRoll(
              rollTicket(
                Date.now() & 0xfffffff,
                Math.min(0.95, Math.max(0.05, winPct / 100)),
                projection.riskUsd,
                projection.rewardUsd,
                projection.spreadUsd,
              ),
            )
          }
        >
          Simulate one fill
        </Button>
      </div>
      {roll ? (
        <p className={cn("mt-2 font-mono text-sm tabular-nums", tone(roll.pnl))}>
          {roll.win ? "Target" : "Stop"} {signedUsd(roll.pnl)}. One draw from the rate you assumed, not from the market.
        </p>
      ) : null}

      <h3 className="mt-5 font-serif text-xl">Venues</h3>
      <p className="mt-1 text-sm text-muted">
        The website is the desk. It will send one Binance spot buy, and only after the gates pass and you type SEND. MetaTrader and Exness are not sockets a browser can open. Their ticket is the bridge file, run on the computer where the terminal is already logged in. Keys are not saved. Nothing loops while you sleep.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Venue">
        {(
          [
            ["paper", "PiP paper"],
            ["binance", "Binance"],
            ["metatrader", "MetaTrader"],
            ["exness", "Exness"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={venue === id}
            onClick={() => setVenue(id)}
            className={cn("press h-11 rounded-sm text-sm", venue === id ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      {venue === "binance" ? (
        <div className="mt-3 grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBinance("Reading the public book…");
                void pingBinance()
                  .then((row) => {
                    setBinance(
                      row.ok && row.price
                        ? `BTCUSDT ${row.price.toFixed(2)}. Public price. Not a fill.`
                        : "Binance did not answer.",
                    );
                  })
                  .catch(() => setBinance("Binance did not answer."));
              }}
            >
              Read BTCUSDT
            </Button>
          </div>
          <p className="text-sm text-muted">{binance}</p>
          {pair !== "BTCUSD" ? (
            <p className="text-sm text-muted">This page sends BTCUSDT only. EURUSD and the rest go through the MetaTrader bridge, not Binance spot.</p>
          ) : verdict.status === "refuse" ? (
            <p className="text-sm text-down">The gates refused this ticket. Binance will not be asked.</p>
          ) : (
            <>
              <label className="block text-sm text-muted">
                Spend, USDT. One click, 5 to 250.
                <input
                  className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
                  inputMode="decimal"
                  value={quoteText}
                  onChange={(event) => setQuoteText(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <input
                className="h-11 rounded-sm bg-surface-2 px-3 text-fg"
                placeholder="Binance API key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <input
                className="h-11 rounded-sm bg-surface-2 px-3 text-fg"
                placeholder="API secret"
                type="password"
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                autoComplete="off"
              />
              <label className="block text-sm text-muted">
                Type SEND to confirm a real market buy.
                <input
                  className="mt-1 h-11 w-full rounded-sm bg-surface-2 px-3 font-mono text-fg"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Button
                type="button"
                disabled={confirm.trim().toUpperCase() !== "SEND" || apiKey.length < 16 || apiSecret.length < 16}
                onClick={() => {
                  const quoteUsdt = Number(quoteText);
                  setBinance("Sending one market buy…");
                  setApiSecret("");
                  setConfirm("");
                  void sendSpot({ data: { symbol: "BTCUSDT", quoteUsdt, apiKey, apiSecret } })
                    .then((row) => {
                      setApiKey("");
                      setBinance(row.detail);
                    })
                    .catch((error: unknown) => {
                      setApiKey("");
                      setBinance(error instanceof Error ? error.message : "The order was not accepted.");
                    });
                }}
              >
                Send one BTCUSDT buy
              </Button>
              <p className="text-sm text-subtle">A short is not a spot order. This button only buys. The secret is cleared when you press it.</p>
            </>
          )}
        </div>
      ) : null}
      {venue === "metatrader" || venue === "exness" ? (
        <div className="mt-3 grid gap-2">
          <p className="text-sm text-muted">
            {venue === "exness"
              ? "Exness is a MetaTrader server. Log the terminal into that server on a computer, then run the bridge once."
              : "MetaTrader has to be open and logged in on Windows. The website cannot see that terminal."}{" "}
            The bridge sends one market order and then stops. It does not run on a phone.
          </p>
          <input
            className="h-11 rounded-sm bg-surface-2 px-3 text-fg"
            placeholder={venue === "exness" ? "Exness server name, for your own notes" : "Broker server, for your own notes"}
            value={serverName}
            onChange={(event) => setServerName(event.target.value)}
            autoComplete="off"
          />
          <input
            className="h-11 rounded-sm bg-surface-2 px-3 text-fg"
            placeholder="Login number, optional, not a password"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            autoComplete="off"
          />
          {verdict.status === "refuse" ? (
            <p className="text-sm text-down">Gates refused this ticket. The bridge command stays hidden.</p>
          ) : (
            <p className="text-sm text-fg">
              On that computer, after the file is there:{" "}
              <span className="font-mono text-sm">
                python mt5_once.py {pair} {side === "long" ? "buy" : "sell"} 0.01 {Math.max(1, Math.round(stopPips))}{" "}
                {Math.max(1, Math.round(stopPips * Math.max(targetR, 0.5)))}
              </span>
            </p>
          )}
          <a className="press inline-flex h-11 items-center rounded-sm bg-surface-2 px-4 text-sm text-fg" href="/mt5_once.py" download="mt5_once.py">
            Bridge for MetaTrader 5
          </a>
          <p className="text-sm text-subtle">
            {serverName.trim() ? `Your note: ${serverName.trim()}` : "No server noted."}
            {login.trim() ? ` · login ${login.trim()}` : ""}. PiP does not connect to it.
          </p>
        </div>
      ) : null}

      <h3 className="mt-5 font-serif text-xl">If you are wrong in a known way</h3>
      <ul className="mt-2">
        {verdict.scenarios.map((row) => (
          <li key={row.name} className="grid grid-cols-[1fr_auto] gap-3 border-t border-border py-3">
            <div>
              <p className="text-sm text-fg">{row.name}</p>
              <p className="text-sm text-muted">{row.note}</p>
            </div>
            <p className={cn("font-mono text-sm tabular-nums", tone(row.pnl))}>{signedUsd(row.pnl)}</p>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-serif text-xl">Open book under the same shocks</h3>
      {positions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Flat. A dollar squeeze marks $0. That is a position.</p>
      ) : (
        <ul className="mt-2">
          {shocks.map((row) => (
            <li key={row.name} className="flex items-baseline justify-between gap-3 border-t border-border py-3">
              <p className="text-sm">{row.name}</p>
              <p className={cn("font-mono text-sm tabular-nums", tone(row.pnl))}>{signedUsd(row.pnl)}</p>
            </li>
          ))}
        </ul>
      )}

      {isFx(pair) ? (
        <div className="mt-5">
          <h3 className="font-serif text-xl">Hourly range, 2010–2026</h3>
          <p className="mt-1 text-sm text-muted">
            {pair}. The light bar is this UTC hour. Past ranges are not a forecast. {PAIRS[pair].estimated ? "This pair’s grid is a desk estimate." : "Taken from the published hourly study."}
          </p>
          <HourProfile pair={pair} hour={hour} zone={zone} now={now ?? new Date()} />
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">
          {pair === "BTCUSD"
            ? "Bitcoin has no honest pip grid on this page. A Kraken study of 2022–2025 put about half of daily variance between 13:00 and 22:00 UTC, which is the New York day wherever you sit. Weekends still trade. FX does not."
            : "Gold uses session ranges from the same study, not a fabricated 24-hour curve. Overlap is the wide hour."}
        </p>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="font-serif text-xl">High-impact calendar</h3>
          {!ctx ? <p className="mt-2 text-sm text-muted">Asking the calendar.</p> : null}
          {ctx?.offline ? <p className="mt-2 text-sm text-muted">Reference and calendar are both offline. Refusals still stand.</p> : null}
          {ctx && !ctx.offline && upcoming.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No high-impact print left in the loaded window.</p>
          ) : null}
          <ul>
            {upcoming.map((event) => (
              <li key={`${event.time}-${event.title}`} className="border-t border-border py-3">
                <p className="font-mono text-sm text-subtle">{zoneStamp(event.time, zone)}</p>
                <p className="text-sm">
                  {event.currency} · {event.title}
                  {event.forecast ? ` · forecast ${event.forecast}` : ""}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-subtle">Watched for this ticket: {currenciesOf(pair).join(", ")}.</p>
        </div>
        <div>
          <h3 className="font-serif text-xl">Daily reference, not a quote</h3>
          <p className="mt-2 text-sm text-muted">
            {ctx?.asOf ? `Published ${ctx.asOf}. You cannot hit these prices.` : "Waiting on the reference feed."}
          </p>
          <ul className="mt-2">
            {(ctx?.quotes ?? []).map((row) => (
              <li key={row.pair} className="flex items-baseline justify-between gap-3 border-t border-border py-2">
                <span className="font-mono text-sm">{row.pair}</span>
                <span className="font-mono text-sm tabular-nums">
                  {row.pair === "BTCUSD" || row.pair === "XAUUSD" ? row.mid.toFixed(row.pair === "BTCUSD" ? 0 : 2) : row.mid.toFixed(row.pair.includes("JPY") ? 3 : 5)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <h3 className="font-serif text-xl">Write the reason, or it did not happen</h3>
        <label className="mt-2 block text-sm text-muted">
          One sentence. What has to be true, and what proves you wrong.
          <textarea
            className="mt-1 h-24 w-full rounded-sm bg-surface-2 p-3 text-fg"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="EURUSD left the Asia high, no USD print for 40 minutes, stop beyond the hour."
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" disabled={reason.trim().length < 12} onClick={write}>
            Enter in the journal
          </Button>
          <a
            className="press inline-flex h-11 items-center rounded-sm bg-surface-2 px-4 text-sm text-fg"
            href="/pip.py"
            download="pip.py"
          >
            Engine for Termux
          </a>
        </div>
        {written ? <p className="mt-2 text-sm text-muted">Recorded on the {venue} label. The desk does not place it.</p> : null}
        <p className="mt-2 text-sm text-subtle">
          In Termux: <span className="font-mono">python pip.py gate EURUSD long 25 300</span>
        </p>
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-xl">Journal</h3>
          {journal.length > 0 ? (
            <button type="button" className="press h-11 text-sm text-muted" onClick={clearJournal}>
              Clear journal
            </button>
          ) : null}
        </div>
        {journal.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Empty. A week of written refusals is the record that matters.</p>
        ) : (
          <ul>
            {journal.map((entry) => (
              <li key={entry.id} className="border-t border-border py-3">
                <p className="font-mono text-sm text-subtle">
                  {zoneStamp(entry.at, zone)} · {entry.pair} {entry.side} · {entry.verdict}
                </p>
                <p className="mt-1 text-sm">{entry.reason}</p>
                <p className="mt-1 text-sm text-muted">{entry.line}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
