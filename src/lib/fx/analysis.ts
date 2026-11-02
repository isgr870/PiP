import { spreadPrice } from "./model";
import {
  HOURLY_PIPS,
  PAIRS,
  hourOf,
  sessionAt,
  type PairId,
  type SessionId,
} from "./research";

/** Desk priors for shock direction. Not a fitted covariance. The sign is the point. */
export const FX_FACTORS: Record<PairId, { usd: number; risk: number }> = {
  EURUSD: { usd: -0.72, risk: 0.35 },
  GBPUSD: { usd: -0.68, risk: 0.55 },
  AUDUSD: { usd: -0.58, risk: 0.7 },
  NZDUSD: { usd: -0.52, risk: 0.62 },
  USDJPY: { usd: 0.48, risk: -0.45 },
  USDCHF: { usd: 0.55, risk: -0.4 },
  USDCAD: { usd: 0.42, risk: -0.15 },
  EURJPY: { usd: -0.22, risk: 0.15 },
};

export type AnalyzedId = PairId | "XAUUSD" | "BTCUSD";

export const ANALYZED: readonly AnalyzedId[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURJPY",
  "XAUUSD",
  "BTCUSD",
];

interface ExtraSpec {
  name: string;
  pip: number;
  spreadPips: number;
  usd: number;
  risk: number;
  /** Dollars of typical hourly range by session. Study-shaped, not a 24-hour grid. */
  sessionRange: Record<SessionId, number>;
}

const EXTRA: Record<"XAUUSD" | "BTCUSD", ExtraSpec> = {
  XAUUSD: {
    name: "Gold",
    pip: 0.01,
    spreadPips: 35,
    usd: -0.4,
    risk: -0.25,
    sessionRange: { tokyo: 4, london: 5, overlap: 8, newyork: 5, late: 3 },
  },
  BTCUSD: {
    name: "Bitcoin",
    pip: 1,
    spreadPips: 30,
    usd: -0.3,
    risk: 1.4,
    sessionRange: { tokyo: 400, london: 500, overlap: 900, newyork: 800, late: 350 },
  },
};

export function instrumentName(id: AnalyzedId): string {
  if (id === "XAUUSD" || id === "BTCUSD") return EXTRA[id].name;
  return PAIRS[id].name;
}

export function factorsOf(id: AnalyzedId): { usd: number; risk: number } {
  if (id === "XAUUSD" || id === "BTCUSD") return { usd: EXTRA[id].usd, risk: EXTRA[id].risk };
  return FX_FACTORS[id];
}

export function currenciesOf(id: AnalyzedId): string[] {
  if (id === "XAUUSD" || id === "BTCUSD") return ["USD"];
  const spec = PAIRS[id];
  return [spec.base, spec.quote];
}

export interface CalEvent {
  time: string;
  currency: string;
  title: string;
  forecast: string;
}

export interface Held {
  pair: AnalyzedId;
  side: "long" | "short";
}

export interface Proposal {
  pair: AnalyzedId;
  side: "long" | "short";
  stopPips: number;
  equity: number;
  cent: boolean;
  riskPct: number;
  minuteUtc: number;
  events: CalEvent[];
  held: Held[];
  calendarOnline: boolean;
}

export interface Clause {
  gate: string;
  pass: boolean;
  hard: boolean;
  text: string;
}

export interface Shock {
  name: string;
  usd: number;
  risk: number;
  note: string;
}

export const SHOCKS: readonly Shock[] = [
  {
    name: "Dollar squeeze",
    usd: 0.006,
    risk: 0,
    note: "A strong US print. About a 0.6% dollar move, nothing else.",
  },
  {
    name: "Risk off",
    usd: 0,
    risk: -0.01,
    note: "Equities down. Yen and gold are paid. Aussie, sterling, and bitcoin pay.",
  },
  {
    name: "Both at once",
    usd: 0.006,
    risk: -0.008,
    note: "The ugly overlap: dollar up and risk down. This is the print you did not flatten for.",
  },
];

export interface ScenarioLine {
  name: string;
  pnl: number;
  note: string;
}

export interface JournalEntry {
  id: string;
  at: string;
  pair: string;
  side: "long" | "short";
  stopPips: number;
  verdict: "allow" | "cut" | "refuse";
  reason: string;
  line: string;
}

export interface Verdict {
  status: "allow" | "cut" | "refuse";
  clauses: Clause[];
  riskUsd: number;
  spreadPips: number;
  spreadShare: number;
  notional: number | null;
  scenarios: ScenarioLine[];
  bookScenarios: ScenarioLine[];
}

function pipSize(id: AnalyzedId): number {
  if (id === "XAUUSD" || id === "BTCUSD") return EXTRA[id].pip;
  return PAIRS[id].pip;
}

function usdPerPriceUnit(id: AnalyzedId): number {
  if (id === "BTCUSD" || id === "XAUUSD") return 1;
  const spec = PAIRS[id];
  if (spec.quote === "USD") return 1;
  if (spec.quote === "JPY") return 1 / 150;
  return 1;
}

function usdPerBaseUnit(id: AnalyzedId, ref?: number): number {
  if (id === "BTCUSD") return ref && ref > 1000 ? ref : 80000;
  if (id === "XAUUSD") return ref && ref > 100 ? ref : 4000;
  const spec = PAIRS[id];
  if (spec.base === "USD") return 1;
  if (spec.quote === "USD") return spec.start;
  return spec.start / 150;
}

export function spreadPipsOf(id: AnalyzedId, minute: number): number {
  if (id === "XAUUSD" || id === "BTCUSD") {
    const base = EXTRA[id].spreadPips;
    const h = Math.floor(hourOf(minute));
    const mult = h >= 21 || h < 0 ? 1.6 : h >= 12 && h < 16 ? 0.85 : h >= 0 && h < 7 ? 1.3 : 1;
    return base * mult;
  }
  return spreadPrice(id, minute) / PAIRS[id].pip;
}

export function typicalHourPips(id: AnalyzedId, minute: number): number {
  const session = sessionAt(minute);
  if (id === "XAUUSD" || id === "BTCUSD") {
    const dollars = EXTRA[id].sessionRange[session.id];
    return dollars / EXTRA[id].pip;
  }
  const h = Math.floor(hourOf(minute));
  return HOURLY_PIPS[id][h] ?? 15;
}

export function suggestedStop(id: AnalyzedId, minute: number): number {
  return Math.max(id === "BTCUSD" ? 400 : 8, Math.round(typicalHourPips(id, minute) * 1.8));
}

function impulse(id: AnalyzedId, side: "long" | "short", key: "usd" | "risk"): number {
  const dir = side === "long" ? 1 : -1;
  return dir * factorsOf(id)[key];
}

const SESSION_LIST: Record<SessionId, readonly AnalyzedId[]> = {
  tokyo: ["USDJPY", "AUDUSD", "NZDUSD", "EURJPY"],
  london: ["EURUSD", "GBPUSD", "USDCHF", "EURJPY", "XAUUSD"],
  overlap: ["EURUSD", "GBPUSD", "USDJPY", "USDCAD", "XAUUSD", "BTCUSD"],
  newyork: ["BTCUSD"],
  late: [],
};

function allowsNewRisk(id: AnalyzedId, session: SessionId): { ok: boolean; text: string } {
  if (session === "late") {
    return { ok: false, text: "Late New York is closed. The range is thinnest and the spread is widest." };
  }
  if (id === "BTCUSD" && session !== "overlap" && session !== "newyork") {
    return { ok: false, text: "Bitcoin outside 16:00–00:00 EAT is the thin part of the day. No new coin risk." };
  }
  if (!SESSION_LIST[session].includes(id)) {
    const where = session === "newyork" ? "New York afternoon takes no new FX or gold risk." : `${id} is not on the ${session} list. Trading it here is how the spread wins.`;
    return { ok: false, text: where };
  }
  if (id === "BTCUSD") {
    return { ok: true, text: "Bitcoin's variance sits in US hours. This window is where that study puts the move." };
  }
  return { ok: true, text: `${id} is on the ${session} list.` };
}

export function fxMarketClosed(now = new Date()): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return true;
  if (day === 0 && hour < 22) return true;
  if (day === 5 && hour >= 22) return true;
  return false;
}

/** Hard gates only. Execution must call this. A soft news cut is not enough to skip it. */
export function executionBlocked(pair: AnalyzedId, stopPips: number, minuteUtc: number, now = new Date()): string | null {
  if (pair !== "BTCUSD" && fxMarketClosed(now)) return "Spot forex is closed. No order was sent.";
  const session = sessionAt(minuteUtc);
  const sessionGate = allowsNewRisk(pair, session.id);
  if (!sessionGate.ok) return `${sessionGate.text} No order was sent.`;
  const noise = typicalHourPips(pair, minuteUtc);
  if (!(stopPips >= noise * 1.5)) return `Stop of ${stopPips.toFixed(0)} sits inside a ${noise.toFixed(0)} hour. No order was sent.`;
  const spread = spreadPipsOf(pair, minuteUtc);
  if (!(stopPips > 0) || spread / stopPips > 0.15) return "Spread is more than 15% of the stop. No order was sent.";
  return null;
}

export function judge(p: Proposal, refPrice?: number): Verdict {
  const session = sessionAt(p.minuteUtc);
  const clauses: Clause[] = [];
  const closed = p.pair !== "BTCUSD" && fxMarketClosed();
  clauses.push({
    gate: "Market",
    pass: !closed,
    hard: true,
    text: closed
      ? "Spot forex is closed. Saturday, and Sunday before 22:00 UTC. Bitcoin still trades."
      : "The cash market for this pair is in its week.",
  });
  const spread = spreadPipsOf(p.pair, p.minuteUtc);
  const noise = typicalHourPips(p.pair, p.minuteUtc);
  const stop = Math.max(p.stopPips, 0);
  const share = stop > 0 ? spread / stop : 1;

  const sessionGate = allowsNewRisk(p.pair, session.id);
  clauses.push({ gate: "Session", pass: sessionGate.ok, hard: true, text: sessionGate.text });

  const stopOk = stop >= noise * 1.5;
  clauses.push({
    gate: "Noise",
    pass: stopOk,
    hard: true,
    text: stopOk
      ? `Stop is ${stop.toFixed(0)} against about ${noise.toFixed(0)} of typical range this hour.`
      : `Stop of ${stop.toFixed(0)} sits inside the hour. Typical range here is about ${noise.toFixed(0)}. Widen it or skip.`,
  });

  const spreadOk = share <= 0.15;
  clauses.push({
    gate: "Spread",
    pass: spreadOk,
    hard: true,
    text: spreadOk
      ? `Spread is about ${(share * 100).toFixed(0)}% of the stop. Under the 15% line.`
      : `Spread is about ${(share * 100).toFixed(0)}% of the stop. Above 15%, the cost is the strategy.`,
  });

  const nowAbs = Date.now();
  let newsHard = false;
  let newsSoft = false;
  let newsText = p.calendarOnline
    ? "No high-impact print on these currencies inside the hour."
    : "Calendar is offline. High-impact minutes are treated as closed until it returns.";
  if (!p.calendarOnline) newsSoft = true;
  const watched = new Set(currenciesOf(p.pair));
  for (const event of p.events) {
    if (!watched.has(event.currency)) continue;
    const when = Date.parse(event.time);
    if (!Number.isFinite(when)) continue;
    const deltaMin = (when - nowAbs) / 60000;
    if (deltaMin >= -15 && deltaMin <= 15) {
      newsHard = true;
      newsText = `${event.currency} ${event.title} is inside 15 minutes. No new order through a print.`;
      break;
    }
    if (deltaMin > 15 && deltaMin <= 60) {
      newsSoft = true;
      newsText = `${event.currency} ${event.title} is inside the hour. Size is cut. Standing aside is cleaner.`;
    }
  }
  clauses.push({ gate: "News", pass: !newsHard && !newsSoft, hard: newsHard, text: newsText });

  const mine = impulse(p.pair, p.side, "usd");
  const crowd = p.held.filter((h) => h.pair !== p.pair && Math.sign(impulse(h.pair, h.side, "usd")) === Math.sign(mine) && Math.abs(mine) > 0.25);
  const crowded = crowd.length > 0 && Math.sign(mine) !== 0;
  clauses.push({
    gate: "Book",
    pass: !crowded,
    hard: false,
    text: crowded
      ? `Same dollar bet as ${crowd.map((c) => c.pair).join(", ")}. A second ticket is not a hedge. Size is cut in half.`
      : p.held.length === 0
        ? "Book is flat. This would be the only bet."
        : "Dollar sign does not stack on what is already open.",
  });

  let status: Verdict["status"] = "allow";
  if (clauses.some((c) => !c.pass && c.hard)) status = "refuse";
  else if (clauses.some((c) => !c.pass)) status = "cut";

  const cut = status === "cut" ? 0.5 : 1;
  const riskUsd = status === "refuse" ? 0 : p.equity * p.riskPct * cut;
  const centFactor = p.cent && p.pair !== "BTCUSD" && p.pair !== "XAUUSD" ? 0.01 : 1;
  const stopDist = stop * pipSize(p.pair);
  const perUnit = stopDist * usdPerPriceUnit(p.pair) * centFactor;
  const units = perUnit > 0 && riskUsd > 0 ? riskUsd / perUnit : 0;
  const notional = units > 0 ? units * usdPerBaseUnit(p.pair, refPrice) * centFactor : null;

  if (status !== "refuse" && notional !== null && p.equity > 0 && notional / p.equity > 8) {
    clauses.push({
      gate: "Leverage",
      pass: false,
      hard: true,
      text: `Notional would be about ${(notional / p.equity).toFixed(1)}× equity. Cap is 8×. The stop is too tight for this account.`,
    });
    status = "refuse";
  } else if (status !== "refuse") {
    clauses.push({
      gate: "Leverage",
      pass: true,
      hard: true,
      text:
        notional === null
          ? "No position."
          : `About ${(notional / Math.max(p.equity, 1)).toFixed(1)}× equity. Under the 8× cap.`,
    });
  }

  const sized = status === "refuse" ? 0 : notional ?? 0;
  const scenarios = SHOCKS.map((shock) => ({
    name: shock.name,
    note: shock.note,
    pnl: sized * (impulse(p.pair, p.side, "usd") * shock.usd + impulse(p.pair, p.side, "risk") * shock.risk),
  }));

  return {
    status,
    clauses,
    riskUsd: status === "refuse" ? 0 : riskUsd,
    spreadPips: spread,
    spreadShare: share,
    notional: status === "refuse" ? null : notional,
    scenarios,
    bookScenarios: [],
  };
}

export function bookShocks(
  positions: { pair: AnalyzedId; side: "long" | "short"; notional: number }[],
): ScenarioLine[] {
  return SHOCKS.map((shock) => ({
    name: shock.name,
    note: shock.note,
    pnl: positions.reduce((sum, pos) => {
      const hit = impulse(pos.pair, pos.side, "usd") * shock.usd + impulse(pos.pair, pos.side, "risk") * shock.risk;
      return sum + pos.notional * hit;
    }, 0),
  }));
}

export interface StakeProjection {
  riskUsd: number;
  rewardUsd: number;
  spreadUsd: number;
  expectancyUsd: number;
  p10: number;
  p50: number;
  p90: number;
  ruin: number;
  note: string;
}

function mixSeed(seed: number): number {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Paths from an assumed win rate. The assumption is the user's, not a forecast. */
export function projectStake(input: {
  stake: number;
  riskPct: number;
  targetR: number;
  spreadShare: number;
  winRate: number;
  trades: number;
  seed?: number;
}): StakeProjection {
  const stake = Math.max(0, input.stake);
  const riskUsd = stake * Math.max(0, input.riskPct);
  const targetR = Math.max(0.1, input.targetR);
  const winRate = Math.min(0.95, Math.max(0.05, input.winRate));
  const trades = Math.min(200, Math.max(1, Math.round(input.trades)));
  const spreadUsd = riskUsd * Math.max(0, input.spreadShare);
  const rewardUsd = riskUsd * targetR;
  const expectancyUsd = winRate * rewardUsd - (1 - winRate) * riskUsd - spreadUsd;
  const ends: number[] = [];
  let ruined = 0;
  const paths = 400;
  let seed = input.seed ?? 0x504950;
  for (let p = 0; p < paths; p++) {
    let equity = stake;
    for (let i = 0; i < trades; i++) {
      seed = (seed + 1) | 0;
      const draw = mixSeed(seed + p * 997);
      const win = draw < winRate;
      equity += (win ? rewardUsd : -riskUsd) - spreadUsd;
      if (equity <= 0) {
        equity = 0;
        break;
      }
    }
    if (equity <= stake * 0.5) ruined += 1;
    ends.push(equity);
  }
  ends.sort((a, b) => a - b);
  const at = (q: number) => ends[Math.min(ends.length - 1, Math.floor(q * (ends.length - 1)))] ?? stake;
  let note = "If the win rate you typed is true, this is the spread of endings. It is not a prediction.";
  if (input.spreadShare > 0.15) note = "The spread is more than 15% of the stop. Most of these paths are paying the broker, not the market.";
  else if (expectancyUsd < 0) note = "At this win rate the ticket loses money after the spread. Refusing it is the trade.";
  else if (ruined / paths > 0.2) note = "Expectancy is positive and the left tail still cuts the stake in half often. Size is the risk, not the story.";
  return {
    riskUsd,
    rewardUsd,
    spreadUsd,
    expectancyUsd,
    p10: at(0.1),
    p50: at(0.5),
    p90: at(0.9),
    ruin: ruined / paths,
    note,
  };
}

export function rollTicket(seed: number, winRate: number, riskUsd: number, rewardUsd: number, spreadUsd: number): {
  win: boolean;
  pnl: number;
} {
  const win = mixSeed(seed) < winRate;
  return { win, pnl: (win ? rewardUsd : -riskUsd) - spreadUsd };
}

export function nearestEvents(events: CalEvent[], limit = 4): CalEvent[] {
  const now = Date.now();
  return events
    .filter((event) => Date.parse(event.time) >= now - 30 * 60 * 1000)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    .slice(0, limit);
}
