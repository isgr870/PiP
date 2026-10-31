import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AnalysisBoard } from "@/components/desk/analysis";
import { EquitySpark, PriceChart } from "@/components/desk/price-chart";
import { buildReport, dayProgress, equityOf, markPnl, realNotional, sessionLabel } from "@/lib/fx/model";
import { useDesk } from "@/lib/fx/store";
import {
  BOOK_PRESETS,
  PAIRS,
  PAIR_ORDER,
  SESSIONS,
  SLEEVES,
  STUDY_LINE,
  ZONES,
  clockUtc,
  formatZone,
  zoneSpan,
  sessionAt,
  signedPct,
  signedUsd,
  usd,
  formatPx,
  formatR,
  type PairId,
  type RiskSleeve,
} from "@/lib/fx/research";
import { cn } from "@/lib/cn";

function tone(n: number): string {
  if (n > 0.004) return "text-up";
  if (n < -0.004) return "text-down";
  return "text-muted";
}

function pips(pair: PairId, from: number, to: number): string {
  const n = (to - from) / PAIRS[pair].pip;
  const body = Math.abs(n).toFixed(1);
  if (n > 0.05) return `+${body}`;
  if (n < -0.05) return `−${body}`;
  return "0.0";
}

function LiveClock() {
  const zone = useDesk((s) => s.zone) || "Africa/Kampala";
  const setZone = useDesk((s) => s.setZone);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);
  const city = ZONES.find((item) => item.id === zone)?.city ?? "Local";
  if (!now) {
    return <p className="text-sm text-muted">Local time loads with the page.</p>;
  }
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const session = sessionAt(utcMin);
  const clock = formatZone(now, zone, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <label className="text-sm text-muted">
          Desk zone
          <select
            className="mt-1 block h-11 rounded-sm bg-surface-2 px-3 text-fg"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          >
            {ZONES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.city}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 font-mono text-2xl text-fg tabular-nums">
          {clock} {city}
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-sm text-fg">{session.name} window</p>
        <p className="text-sm text-muted">
          Tokyo {zoneSpan(0, 7, zone, now)} · London {zoneSpan(7, 16, zone, now)} · New York {zoneSpan(12, 21, zone, now)}
        </p>
      </div>
    </div>
  );
}

export function Desk() {
  const book = useDesk((s) => s.book);
  const phase = useDesk((s) => s.phase);
  const risk = useDesk((s) => s.risk);
  const enabled = useDesk((s) => s.enabled);
  const selected = useDesk((s) => s.selected);
  const run = useDesk((s) => s.run);
  const step = useDesk((s) => s.step);
  const flatten = useDesk((s) => s.flatten);
  const reset = useDesk((s) => s.reset);
  const setRisk = useDesk((s) => s.setRisk);
  const setBook = useDesk((s) => s.setBook);
  const togglePair = useDesk((s) => s.togglePair);
  const select = useDesk((s) => s.select);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    void useDesk.persist.rehydrate();
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || phase !== "running") return;
    const id = window.setInterval(() => step(), 150);
    return () => window.clearInterval(id);
  }, [hydrated, phase, step]);

  const equity = equityOf(book);
  const dayPnl = equity - book.dayOpenEquity;
  const dayRet = book.dayOpenEquity > 0 ? dayPnl / book.dayOpenEquity : 0;
  const progress = dayProgress(book);
  const report = phase === "brief" ? buildReport(book) : null;
  const spec = PAIRS[selected];
  const px = book.mids[selected];
  const openPx = book.dayOpenMids[selected] || px;
  const active = sessionAt(book.simMinute);
  const locked = phase === "running";
  const anyOn = PAIR_ORDER.some((id) => enabled[id]);
  const zone = useDesk((s) => s.zone) || "Africa/Kampala";
  const [stakeText, setStakeText] = useState(String(book.cash));
  const [wall, setWall] = useState<Date | null>(null);

  useEffect(() => {
    setStakeText(String(book.cash));
  }, [book.cash]);

  useEffect(() => {
    setWall(new Date());
  }, []);

  const primary =
    phase === "running" ? "Pause" : phase === "paused" ? "Resume" : phase === "brief" ? "Run another day" : "Run a paper day";

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-sm text-subtle">The website. Add it to your home screen.</p>
            <h1 className="font-serif text-3xl leading-tight tracking-tight">PiP</h1>
          </div>
          <p className="font-mono text-sm text-muted tabular-nums">
            {clockUtc(book.simMinute)} · {phase === "ready" ? "Tape armed" : sessionLabel(book.simMinute)}
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4">
        <section className="rounded-xl bg-surface p-4">
          <LiveClock />
        </section>

        <AnalysisBoard
          equity={equity}
          cent={book.cent}
          risk={risk}
          positions={book.positions}
          mids={book.mids}
          minute={book.simMinute}
        />

        <section className="rounded-xl border border-border p-4">
          <h2 className="font-serif text-2xl leading-tight">What the hours actually do</h2>
          <p className="mt-3 max-w-3xl text-base text-fg">
            A desk that trades while you sleep is trading the thin hours. In sixteen years of hourly bid ranges, EURUSD averages 13.3 pips an hour in Tokyo and 26.1 pips in the London–New York overlap. PiP shows that overlap in your zone{wall ? `: ${zoneSpan(12, 16, zone, wall)}` : ""}. That is where a small stake has any chance of clearing the spread. It is still not a wage.
          </p>
          <p className="mt-3 max-w-3xl text-sm text-muted">{STUDY_LINE}</p>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {SESSIONS.filter((s) => s.id !== "late").map((s) => (
              <li key={s.id} className="rounded-lg bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-xl">{s.name}</h3>
                  <p className="font-mono text-sm text-muted">{wall ? zoneSpan(s.startHour, s.endHour, zone, wall) : "…"}</p>
                </div>
                <p className="mt-2 text-sm text-muted">EURUSD about {s.eurusdPips} pips an hour.</p>
                <p className="mt-2 text-sm">{s.rule}</p>
                {s.pairs.length > 0 ? (
                  <p className="mt-3 font-mono text-sm text-subtle">{s.pairs.join("  ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl bg-surface p-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted">{book.cent ? "Cent paper equity" : "Paper equity"}</p>
              <p className="font-serif text-4xl tabular-nums">{usd(equity)}</p>
            </div>
            <div className="text-left sm:text-right">
              <p className={cn("font-mono text-lg tabular-nums", tone(dayPnl))}>{signedUsd(dayPnl)}</p>
              <p className="text-sm text-muted">{signedPct(dayRet)} this day</p>
            </div>
          </div>
          <div
            className="mt-4 h-1 overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="Session progress"
          >
            <div className="night-progress h-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {SESSIONS.filter((s) => s.id !== "late").map((s) => (
              <span key={s.id} className={active.id === s.id && phase !== "ready" ? "text-fg" : "text-subtle"}>
                {s.name}
              </span>
            ))}
          </div>
          <EquitySpark points={book.curve} />
        </section>

        <div className="grid gap-4 lg:grid-cols-12">
          <section className="rounded-xl bg-surface p-4 lg:col-span-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl">{spec.name}</h2>
                <p className="font-mono text-sm text-muted">{selected}</p>
              </div>
              <div className="text-left sm:text-right">
                <p className="font-mono text-xl tabular-nums">{formatPx(selected, px)}</p>
                <p className={cn("font-mono text-sm tabular-nums", tone(px - openPx))}>
                  {pips(selected, openPx, px)} pips from the day open
                </p>
              </div>
            </div>
            <div className="mt-3 h-64 sm:h-72">
              <PriceChart pair={selected} bars={book.bars[selected]} />
            </div>
          </section>

          <aside className="rounded-xl bg-surface p-4 lg:col-span-4">
            {report ? (
              <div className="mb-4">
                <h2 className="font-serif text-xl" tabIndex={-1}>
                  Day {report.day} brief
                </h2>
                <p className={cn("mt-2 font-mono text-lg tabular-nums", tone(report.pnl))}>{signedUsd(report.pnl)}</p>
                <p className="mt-2 text-sm text-muted">
                  {report.trades.length} trades · {report.wins} wins · avg {formatR(report.avgR)} · drawdown{" "}
                  {(report.maxDd * 100).toFixed(1)}%
                </p>
                <p className="mt-2 text-sm">{report.blurb}</p>
              </div>
            ) : null}

            <p className="text-sm text-muted">Stake, any amount in dollars</p>
            <div className="mt-2 flex gap-2">
              <input
                className="h-11 min-w-0 flex-1 rounded-sm bg-surface-2 px-3 font-mono text-fg"
                inputMode="decimal"
                aria-label="Stake in dollars"
                value={stakeText}
                disabled={locked}
                onChange={(event) => setStakeText(event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={locked}
                onClick={() => {
                  const next = Number(stakeText);
                  if (Number.isFinite(next) && next > 0) setBook(next, book.cent);
                }}
              >
                Use
              </Button>
            </div>
            <button
              type="button"
              className="press mt-2 h-11 text-sm text-muted"
              disabled={locked}
              onClick={() => setBook(book.cash, !book.cent)}
            >
              {book.cent ? "Cent sizing on" : "Standard sizing"} — tap to switch
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {BOOK_PRESETS.map((preset) => {
                const on = book.cash === preset.cash && book.cent === preset.cent;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={locked}
                    aria-pressed={on}
                    onClick={() => setBook(preset.cash, preset.cent)}
                    className={cn(
                      "press h-11 rounded-sm px-2 text-sm",
                      on ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-sm text-muted">
              {book.cent
                ? "Cent account: pip value is one hundredth of a standard lot, so a real stop can fit inside the sleeve."
                : "Standard lot size. On $100 the desk should refuse almost every trade. That refusal is the lesson."}
            </p>

            <p className="mt-4 text-sm text-muted">Sleeve</p>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Risk sleeve">
              {(Object.keys(SLEEVES) as RiskSleeve[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={risk === id}
                  disabled={locked}
                  onClick={() => setRisk(id)}
                  className={cn(
                    "press h-11 rounded-sm text-sm font-medium",
                    risk === id ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
                  )}
                >
                  {SLEEVES[id].label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm text-muted">{SLEEVES[risk].detail}</p>

            <p className="mt-4 text-sm text-muted">Pairs</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PAIR_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={enabled[id]}
                  onClick={() => togglePair(id)}
                  className={cn(
                    "press h-11 rounded-sm px-3 font-mono text-sm",
                    enabled[id] ? "bg-surface-2 text-fg" : "text-subtle",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            {anyOn ? null : <p className="mt-2 text-sm text-muted">All pairs are off. The day will pass flat.</p>}

            <Button className="mt-4 w-full" size="lg" onClick={run}>
              {primary}
            </Button>
            <p className="mt-2 text-sm text-muted">
              {phase === "running"
                ? "About fifteen seconds. Pause if you want to read a fill."
                : "15-minute bars, Tokyo through New York, flat at 21:00 UTC. Costs are on."}
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" className="flex-1" disabled={book.positions.length === 0} onClick={flatten}>
                Flatten
              </Button>
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <Button variant="ghost" className="flex-1">
                    Reset book
                  </Button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="fixed inset-0 bg-bg/80" />
                  <Dialog.Content className="fixed top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 px-4">
                    <div className="rounded-2xl bg-surface p-6">
                      <Dialog.Title className="font-serif text-xl">Reset the paper book?</Dialog.Title>
                      <Dialog.Description className="mt-2 text-sm text-muted">
                        Clears the tape and the fills. The research on the page stays.
                      </Dialog.Description>
                      <div className="mt-4 flex gap-2">
                        <Dialog.Close asChild>
                          <Button variant="secondary" className="flex-1">
                            Keep it
                          </Button>
                        </Dialog.Close>
                        <Dialog.Close asChild>
                          <Button className="flex-1" onClick={reset}>
                            Reset
                          </Button>
                        </Dialog.Close>
                      </div>
                    </div>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </div>
          </aside>

          <section className="lg:col-span-8">
            <h2 className="mb-2 text-sm text-muted">Tape</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PAIR_ORDER.map((id) => {
                const price = book.mids[id];
                const from = book.dayOpenMids[id] || price;
                const delta = price - from;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-pressed={selected === id}
                      onClick={() => select(id)}
                      className={cn(
                        "press w-full rounded-lg border px-3 py-3 text-left",
                        selected === id ? "border-fg bg-surface" : "border-border bg-surface",
                        enabled[id] ? "" : "opacity-40",
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-sm">{id}</span>
                        <span className={cn("font-mono text-sm tabular-nums", tone(delta))}>{pips(id, from, price)}</span>
                      </span>
                      <span className="mt-1 block font-mono text-lg tabular-nums">{formatPx(id, price)}</span>
                      <span className="text-sm text-muted">{PAIRS[id].name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-xl bg-surface p-4 lg:col-span-4">
            <h2 className="font-serif text-xl">Open risk</h2>
            {book.positions.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Flat. No inventory.</p>
            ) : (
              <ul className="mt-3">
                {book.positions.map((pos) => {
                  const pnl = markPnl(pos, book.mids, book.simMinute, book.cent);
                  return (
                    <li key={pos.id} className="border-t border-border py-3 first:border-t-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-mono text-sm">
                          {pos.pair} {pos.side}
                        </p>
                        <p className={cn("font-mono text-sm tabular-nums", tone(pnl))}>{signedUsd(pnl)}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {(pos.units / 100000).toFixed(2)} lot · risk {usd(pos.riskUsd)} · {pos.session}
                      </p>
                      <p className="mt-1 text-sm">{pos.reason}</p>
                    </li>
                  );
                })}
              </ul>
            )}
            {book.positions.length > 0 ? (
              <p className="mt-2 text-sm text-subtle">
                Real exposure about {usd(book.positions.reduce((a, p) => a + realNotional(p, book.mids, book.cent), 0))}.
              </p>
            ) : null}
          </section>

          <section className="rounded-xl bg-surface p-4 lg:col-span-12">
            <Tabs.Root defaultValue="notes">
              <Tabs.List className="flex gap-2">
                <Tabs.Trigger
                  value="notes"
                  className="press h-11 rounded-sm px-3 text-sm text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-fg"
                >
                  Desk notes
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="trades"
                  className="press h-11 rounded-sm px-3 text-sm text-muted data-[state=active]:bg-surface-2 data-[state=active]:text-fg"
                >
                  Fills
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="notes" className="mt-2 max-h-96 overflow-auto">
                <ul>
                  {book.notes.map((note) => (
                    <li key={note.id} className="border-t border-border py-3 first:border-t-0">
                      <p className="font-mono text-sm text-subtle">{clockUtc(note.t)}</p>
                      <p className="text-sm">{note.text}</p>
                    </li>
                  ))}
                </ul>
              </Tabs.Content>
              <Tabs.Content value="trades" className="mt-2 max-h-96 overflow-auto">
                {book.trades.length === 0 ? (
                  <p className="py-3 text-sm text-muted">No fills yet.</p>
                ) : (
                  <ul>
                    {book.trades.map((trade) => (
                      <li key={`${trade.id}-${trade.closedAt}`} className="grid grid-cols-[1fr_auto] gap-3 border-t border-border py-3 first:border-t-0">
                        <div>
                          <p className="font-mono text-sm">
                            {trade.pair} {trade.side}
                          </p>
                          <p className="text-sm text-muted">
                            {clockUtc(trade.closedAt)} · {trade.exitReason} · {trade.session}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={cn("font-mono text-sm tabular-nums", tone(trade.pnl))}>{signedUsd(trade.pnl)}</p>
                          <p className="font-mono text-sm text-muted tabular-nums">{formatR(trade.rMultiple)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Tabs.Content>
            </Tabs.Root>
          </section>
        </div>

        <footer className="pb-8">
          <p className="max-w-3xl text-sm text-muted">
            This page is the app. There is no Play Store build. One Binance spot buy can leave this page after the gates pass and you type SEND. MetaTrader and Exness take a ticket only from the bridge on a computer where the terminal is already logged in. Nothing here trades while you sleep.
          </p>
          <p className="mt-2 text-sm text-subtle">
            <a
              className="underline decoration-border underline-offset-4"
              href="https://fxbacktest.app/research/forex-volatility-by-hour/"
              rel="noreferrer"
            >
              Hourly range study, 2010–2026
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
