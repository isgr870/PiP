import {
  HOURLY_PIPS,
  PAIRS,
  PAIR_ORDER,
  SLEEVES,
  hourOf,
  mapPairs,
  sessionAt,
  type PairId,
  type RiskSleeve,
  type SessionId,
} from "./research.ts";

export type { PairId, RiskSleeve, SessionId };

export const BAR_MINUTES = 15;
export const DAY_END_HOUR = 21;
export const MIN_UNITS = 1000;
const SIGMA_DIV = 2.35;
const MAX_REAL_LEVERAGE = 10;
const OPENING_SEED = 0x4b414d50;

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export type Side = "long" | "short";

export interface Position {
  id: string;
  day: number;
  pair: PairId;
  side: Side;
  session: SessionId;
  units: number;
  entry: number;
  stop: number;
  target: number;
  openedAt: number;
  reason: string;
  riskUsd: number;
}

export interface ClosedTrade {
  id: string;
  day: number;
  pair: PairId;
  side: Side;
  session: SessionId;
  units: number;
  entry: number;
  exit: number;
  openedAt: number;
  closedAt: number;
  pnl: number;
  rMultiple: number;
  reason: string;
  exitReason: string;
}

export interface Note {
  id: string;
  t: number;
  day: number;
  text: string;
}

export interface Book {
  cash: number;
  cent: boolean;
  simMinute: number;
  rng: number;
  mids: Record<PairId, number>;
  bars: Record<PairId, Bar[]>;
  positions: Position[];
  trades: ClosedTrade[];
  notes: Note[];
  curve: { t: number; v: number }[];
  dayOpenEquity: number;
  dayOpenMids: Record<PairId, number>;
  peakEquity: number;
  maxDd: number;
  halted: boolean;
  day: number;
  dayStart: number;
  dayEnd: number;
  tradeSeq: number;
  noteSeq: number;
  sleeve: RiskSleeve;
  fired: string[];
  skipNoted: PairId[];
  asiaHigh: Record<PairId, number | null>;
  asiaLow: Record<PairId, number | null>;
  toldLondon: boolean;
  toldOverlap: boolean;
  toldNewYork: boolean;
  cooldown: Record<PairId, number>;
}

export interface StepCtx {
  trade: boolean;
  enabled: Record<PairId, boolean>;
  risk: RiskSleeve;
}

export interface Report {
  day: number;
  startEquity: number;
  endEquity: number;
  pnl: number;
  ret: number;
  trades: ClosedTrade[];
  wins: number;
  losses: number;
  avgR: number;
  best: ClosedTrade | null;
  worst: ClosedTrade | null;
  maxDd: number;
  halted: boolean;
  blurb: string;
}

function rngNext(seed: number): { seed: number; value: number } {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { seed: a >>> 0 || 1, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

function gauss(seed: number): { seed: number; z: number } {
  const a = rngNext(seed || 1);
  const b = rngNext(a.seed);
  const u = Math.max(a.value, 1e-9);
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * b.value);
  return { seed: b.seed, z };
}

function stir(seed: number, salt: number): number {
  let s = (seed ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  if (s === 0) s = 0x1a2b3c4d;
  return rngNext(s).seed;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const USD_BETA: Record<PairId, number> = {
  EURUSD: -0.72,
  GBPUSD: -0.68,
  AUDUSD: -0.58,
  NZDUSD: -0.52,
  USDJPY: 0.48,
  USDCHF: 0.55,
  USDCAD: 0.42,
  EURJPY: -0.22,
};

export function spreadPrice(pair: PairId, minute: number): number {
  const spec = PAIRS[pair];
  const h = Math.floor(hourOf(minute));
  let mult = 1.15;
  if (h >= 12 && h < 16) mult = 0.85;
  else if (h >= 7 && h < 12) mult = 1;
  else if (h >= 16 && h < 21) mult = 1.1;
  else if (h >= 0 && h < 7) mult = 1.35;
  else mult = 1.75;
  return spec.spreadPips * mult * spec.pip;
}

function adverse(pair: PairId, minute: number): number {
  return spreadPrice(pair, minute) / 2 + PAIRS[pair].pip * 0.2;
}

export function usdPerPrice(pair: PairId, px: number, mids: Record<PairId, number>): number {
  const spec = PAIRS[pair];
  if (spec.quote === "USD") return 1;
  if (spec.quote === "JPY") return 1 / Math.max(mids.USDJPY, 1);
  return 1 / Math.max(px, 1e-8);
}

export function usdPerBase(pair: PairId, px: number, mids: Record<PairId, number>): number {
  const spec = PAIRS[pair];
  if (spec.base === "USD") return 1;
  if (spec.quote === "USD") return px;
  return px / Math.max(mids.USDJPY, 1);
}

function money(pair: PairId, side: Side, entry: number, exit: number, units: number, mids: Record<PairId, number>, cent: boolean): number {
  const dir = side === "long" ? 1 : -1;
  const conv = exit > 0 ? exit : entry;
  const raw = (exit - entry) * dir * units * usdPerPrice(pair, conv, mids);
  return raw * (cent ? 0.01 : 1);
}

export function markPnl(pos: Position, mids: Record<PairId, number>, minute: number, cent: boolean): number {
  const slip = adverse(pos.pair, minute);
  const exit = pos.side === "long" ? mids[pos.pair] - slip : mids[pos.pair] + slip;
  return money(pos.pair, pos.side, pos.entry, exit, pos.units, mids, cent);
}

export function equityOf(book: Book): number {
  let open = 0;
  for (const pos of book.positions) open += markPnl(pos, book.mids, book.simMinute, book.cent);
  return book.cash + open;
}

export function realNotional(pos: Position, mids: Record<PairId, number>, cent: boolean): number {
  return pos.units * usdPerBase(pos.pair, mids[pos.pair], mids) * (cent ? 0.01 : 1);
}

function pushNote(book: Book, text: string, t: number): Pick<Book, "notes" | "noteSeq"> {
  const noteSeq = book.noteSeq + 1;
  const note: Note = { id: `n${noteSeq}`, t, day: book.day, text };
  return { noteSeq, notes: [note, ...book.notes].slice(0, 80) };
}

function atr(bars: Bar[], n = 14): number {
  if (bars.length < n + 1) return 0;
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) continue;
    sum += Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
  }
  return sum / n;
}

function zscore(bars: Bar[], n = 16): { z: number; mean: number } {
  if (bars.length < n) return { z: 0, mean: bars[bars.length - 1]?.c ?? 0 };
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) sum += bars[i]?.c ?? 0;
  const mean = sum / n;
  let v = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const d = (bars[i]?.c ?? mean) - mean;
    v += d * d;
  }
  const sd = Math.sqrt(v / (n - 1));
  const last = bars[bars.length - 1]?.c ?? mean;
  if (sd <= 0) return { z: 0, mean };
  return { z: (last - mean) / sd, mean };
}

interface Idea {
  pair: PairId;
  side: Side;
  session: SessionId;
  stopDist: number;
  targetDist: number;
  reason: string;
  score: number;
}

function fillsToday(book: Book): number {
  let n = book.positions.length;
  for (const t of book.trades) if (t.day === book.day) n += 1;
  return n;
}

function firedKey(session: SessionId, pair: PairId): string {
  return `${session}:${pair}`;
}

function ideaFor(book: Book, pair: PairId): Idea | null {
  const bars = book.bars[pair];
  if (bars.length < 18) return null;
  if (book.simMinute < (book.cooldown[pair] ?? 0)) return null;
  const spec = PAIRS[pair];
  const hour = hourOf(book.simMinute);
  const last = bars[bars.length - 1]?.c ?? book.mids[pair];
  const range = atr(bars);
  const spread = spreadPrice(pair, book.simMinute);
  if (range < spec.pip * 3) return null;

  if (hour >= 1 && hour < 6.5 && (pair === "USDJPY" || pair === "AUDUSD" || pair === "NZDUSD" || pair === "EURJPY")) {
    if (book.fired.includes(firedKey("tokyo", pair))) return null;
    const { z, mean } = zscore(bars);
    if (Math.abs(z) < 2.05) return null;
    const dist = Math.abs(last - mean);
    const stopDist = Math.max(dist * 0.6, spec.pip * 6);
    const targetDist = dist * 0.85;
    if (spread > stopDist * 0.16) return null;
    const side: Side = z > 0 ? "short" : "long";
    return {
      pair,
      side,
      session: "tokyo",
      stopDist,
      targetDist,
      score: Math.abs(z),
      reason: `Tokyo fade. ${pair} is ${Math.abs(z).toFixed(1)}σ ${side === "short" ? "above" : "below"} its 4-hour mean. Spread is small enough to try.`,
    };
  }

  if (hour >= 7 && hour < 10 && (pair === "EURUSD" || pair === "GBPUSD" || pair === "USDCHF")) {
    if (book.fired.includes(firedKey("london", pair))) return null;
    const hi = book.asiaHigh[pair];
    const lo = book.asiaLow[pair];
    if (hi == null || lo == null || hi <= lo) return null;
    const width = hi - lo;
    if (width < spread * 8 || width > range * 7) return null;
    const buf = spread * 1.5;
    let side: Side | null = null;
    if (last > hi + buf) side = "long";
    else if (last < lo - buf) side = "short";
    if (!side) return null;
    const stopDist = Math.max(width * 0.85, spec.pip * 8);
    const targetDist = width * 0.9;
    if (spread > stopDist * 0.16) return null;
    return {
      pair,
      side,
      session: "london",
      stopDist,
      targetDist,
      score: 2 + width / range,
      reason: `London break. ${pair} left the Asia range. One try. A failed break is a normal outcome, not a surprise.`,
    };
  }

  if (hour >= 12 && hour < 16 && (pair === "EURUSD" || pair === "GBPUSD" || pair === "USDJPY" || pair === "USDCAD")) {
    if (book.fired.includes(firedKey("overlap", pair))) return null;
    if (bars.length < 10) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = bars.length - 9; i < bars.length - 1; i++) {
      const b = bars[i];
      if (!b) continue;
      hi = Math.max(hi, b.h);
      lo = Math.min(lo, b.l);
    }
    if (!Number.isFinite(hi) || hi <= lo) return null;
    let side: Side | null = null;
    if (last > hi) side = "long";
    else if (last < lo) side = "short";
    if (!side) return null;
    const stopDist = Math.max(range * 1.15, spec.pip * 8);
    const targetDist = stopDist * 1.65;
    if (spread > stopDist * 0.14) return null;
    return {
      pair,
      side,
      session: "overlap",
      stopDist,
      targetDist,
      score: Math.abs(last - (side === "long" ? hi : lo)) / range,
      reason: `Overlap. ${pair} cleared the prior two hours during the busiest window. Size stays inside the sleeve.`,
    };
  }

  return null;
}

function closePosition(book: Book, pos: Position, exit: number, exitReason: string, t: number): Book {
  const pnl = money(pos.pair, pos.side, pos.entry, exit, pos.units, book.mids, book.cent);
  const rMultiple = pos.riskUsd > 0 ? pnl / pos.riskUsd : 0;
  const trade: ClosedTrade = {
    id: pos.id,
    day: pos.day,
    pair: pos.pair,
    side: pos.side,
    session: pos.session,
    units: pos.units,
    entry: pos.entry,
    exit,
    openedAt: pos.openedAt,
    closedAt: t,
    pnl,
    rMultiple,
    reason: pos.reason,
    exitReason,
  };
  const noted = pushNote(book, `${exitReason}. ${pos.pair} ${pos.side} ${formatRLocal(rMultiple)}, ${signedLocal(pnl)}.`, t);
  return {
    ...book,
    cash: book.cash + pnl,
    positions: book.positions.filter((p) => p.id !== pos.id),
    trades: [trade, ...book.trades].slice(0, 160),
    cooldown: { ...book.cooldown, [pos.pair]: t + 90 },
    notes: noted.notes,
    noteSeq: noted.noteSeq,
  };
}

function formatRLocal(n: number): string {
  const body = `${Math.abs(n).toFixed(2)}R`;
  if (n > 0.004) return `+${body}`;
  if (n < -0.004) return `−${body}`;
  return body;
}

function signedLocal(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (n > 0.004) return `+${abs}`;
  if (n < -0.004) return `−${abs}`;
  return abs;
}

function considerExit(pos: Position, bar: Bar, now: number): { exit: number; reason: string } | null {
  const slip = PAIRS[pos.pair].pip * 0.25;
  if (pos.side === "long") {
    if (bar.l <= pos.stop) return { exit: (bar.o <= pos.stop ? bar.o : pos.stop) - slip, reason: "Stop" };
    if (bar.h >= pos.target) return { exit: (bar.o >= pos.target ? bar.o : pos.target) - slip, reason: "Target" };
  } else {
    if (bar.h >= pos.stop) return { exit: (bar.o >= pos.stop ? bar.o : pos.stop) + slip, reason: "Stop" };
    if (bar.l <= pos.target) return { exit: (bar.o <= pos.target ? bar.o : pos.target) + slip, reason: "Target" };
  }
  if (now - pos.openedAt >= 120) {
    const span = pos.side === "long" ? pos.target - pos.entry : pos.entry - pos.target;
    const traveled = pos.side === "long" ? bar.c - pos.entry : pos.entry - bar.c;
    if (span > 0 && traveled / span < 0.3) {
      const slipPx = adverse(pos.pair, now);
      return { exit: pos.side === "long" ? bar.c - slipPx : bar.c + slipPx, reason: "Time stop" };
    }
  }
  return null;
}

function openFromIdea(book: Book, idea: Idea, openMid: number, t: number, risk: RiskSleeve): Book {
  if (book.positions.some((p) => p.pair === idea.pair)) return book;
  const sleeve = SLEEVES[risk];
  if (book.positions.length >= sleeve.maxPos) return book;
  if (fillsToday(book) >= sleeve.budget) return book;
  const equity = equityOf(book);
  const slip = adverse(idea.pair, t);
  const entry = idea.side === "long" ? openMid + slip : openMid - slip;
  const perUnitStandard = idea.stopDist * usdPerPrice(idea.pair, entry, book.mids);
  const perUnit = perUnitStandard * (book.cent ? 0.01 : 1);
  if (perUnit <= 0 || equity <= 0) return book;
  const budget = equity * sleeve.pct;
  let units = budget / perUnit;
  const realPerUnit = usdPerBase(idea.pair, entry, book.mids) * (book.cent ? 0.01 : 1);
  const maxUnits = (equity * MAX_REAL_LEVERAGE) / Math.max(realPerUnit, 1e-9);
  units = Math.min(units, maxUnits);
  if (units < MIN_UNITS) {
    if (book.skipNoted.includes(idea.pair)) return book;
    const minRisk = MIN_UNITS * perUnit;
    const pct = equity > 0 ? minRisk / equity : 1;
    const noted = pushNote(
      book,
      `Skipped ${idea.pair}. Smallest 0.01 lot risks ${signedLocal(minRisk).replace("+", "")} (${(pct * 100).toFixed(1)}% of the book). The sleeve allows ${(sleeve.pct * 100).toFixed(2)}%.`,
      t,
    );
    return { ...book, ...noted, skipNoted: [...book.skipNoted, idea.pair] };
  }
  units = Math.floor(units);
  const actualRisk = units * perUnit;
  const stop = idea.side === "long" ? entry - idea.stopDist : entry + idea.stopDist;
  const target = idea.side === "long" ? entry + idea.targetDist : entry - idea.targetDist;
  const tradeSeq = book.tradeSeq + 1;
  const pos: Position = {
    id: `t${tradeSeq}`,
    day: book.day,
    pair: idea.pair,
    side: idea.side,
    session: idea.session,
    units,
    entry,
    stop,
    target,
    openedAt: t,
    reason: idea.reason,
    riskUsd: actualRisk,
  };
  const noted = pushNote(book, idea.reason, t);
  return {
    ...book,
    tradeSeq,
    positions: [...book.positions, pos],
    fired: [...book.fired, firedKey(idea.session, idea.pair)],
    notes: noted.notes,
    noteSeq: noted.noteSeq,
  };
}

function evolve(book: Book): { book: Book; opens: Record<PairId, number> } {
  let rng = book.rng;
  const usd = gauss(rng);
  rng = usd.seed;
  const mids = { ...book.mids };
  const bars = { ...book.bars };
  const asiaHigh = { ...book.asiaHigh };
  const asiaLow = { ...book.asiaLow };
  const opens = { ...book.mids };
  const t = book.simMinute + BAR_MINUTES;
  const hour = clamp(Math.floor(hourOf(t)), 0, 23);

  for (const id of PAIR_ORDER) {
    const spec = PAIRS[id];
    const idio = gauss(rng);
    rng = idio.seed;
    const wick = rngNext(rng);
    rng = wick.seed;
    const prev = book.mids[id];
    const pips = HOURLY_PIPS[id][hour] ?? 12;
    const rangeRel = (pips * spec.pip) / Math.max(prev, spec.pip);
    const sigma = rangeRel / SIGMA_DIV;
    const shock = sigma * (USD_BETA[id] * usd.z * 0.62 + idio.z * 0.78);
    const ret = clamp(shock, -0.015, 0.015);
    const c = Math.max(prev * Math.exp(ret), spec.pip);
    const noise = Math.abs(idio.z) * prev * sigma * 0.45;
    const up = noise * (0.25 + 0.75 * wick.value);
    const dn = noise * (0.25 + 0.75 * (1 - wick.value));
    const bar: Bar = {
      t,
      o: prev,
      h: Math.max(prev, c) + up,
      l: Math.max(spec.pip * 0.5, Math.min(prev, c) - dn),
      c,
    };
    const list = book.bars[id];
    const copy = list.length >= 220 ? list.slice(list.length - 219) : list.slice();
    copy.push(bar);
    bars[id] = copy;
    mids[id] = c;
    opens[id] = prev;
    const h = hourOf(t);
    if (h >= 0 && h < 7) {
      asiaHigh[id] = asiaHigh[id] == null ? bar.h : Math.max(asiaHigh[id], bar.h);
      asiaLow[id] = asiaLow[id] == null ? bar.l : Math.min(asiaLow[id], bar.l);
    }
  }

  return { opens, book: { ...book, rng, mids, bars, asiaHigh, asiaLow, simMinute: t } };
}

export function flattenAll(book: Book, reason: string): Book {
  let next = book;
  for (const pos of [...book.positions]) {
    if (!next.positions.some((p) => p.id === pos.id)) continue;
    const slip = adverse(pos.pair, next.simMinute);
    const mid = next.mids[pos.pair];
    const exit = pos.side === "long" ? mid - slip : mid + slip;
    next = closePosition(next, pos, exit, reason, next.simMinute);
  }
  return next;
}

function settle(book: Book, now: number): Book {
  let next = book;
  for (const pos of [...book.positions]) {
    if (!next.positions.some((p) => p.id === pos.id)) continue;
    const bars = next.bars[pos.pair];
    const bar = bars[bars.length - 1];
    if (!bar) continue;
    const hit = considerExit(pos, bar, now);
    if (hit) next = closePosition(next, pos, hit.exit, hit.reason, now);
  }
  return next;
}

const SILENT_ENABLED = mapPairs(false);

export function advanceBar(book: Book, ctx: StepCtx): { book: Book; done: boolean } {
  if (ctx.trade && book.simMinute >= book.dayEnd) return { book, done: true };

  let working = book;
  const ideas: Idea[] = [];
  const hour = hourOf(working.simMinute);
  if (ctx.trade && !working.halted && hour < 16 && working.simMinute < working.dayEnd - 30) {
    const sleeve = SLEEVES[ctx.risk];
    if (working.positions.length < sleeve.maxPos && fillsToday(working) < sleeve.budget) {
      for (const id of PAIR_ORDER) {
        if (!ctx.enabled[id]) continue;
        const next = ideaFor(working, id);
        if (next) ideas.push(next);
      }
      ideas.sort((a, b) => b.score - a.score);
    }
  }

  const evolved = evolve(working);
  working = evolved.book;
  if (ctx.trade) {
    const before = working.positions.length;
    for (const candidate of ideas) {
      if (!ctx.enabled[candidate.pair]) continue;
      working = openFromIdea(working, candidate, evolved.opens[candidate.pair], working.simMinute, ctx.risk);
      if (working.positions.length > before) break;
    }
  }
  working = settle(working, working.simMinute);

  const h = hourOf(working.simMinute);
  if (ctx.trade && !working.toldLondon && h >= 7 && h < 12) {
    const noted = pushNote(working, "London is open. One Asia-range break per pair, then the desk stops asking.", working.simMinute);
    working = { ...working, ...noted, toldLondon: true };
  }
  if (ctx.trade && !working.toldOverlap && h >= 12 && h < 16) {
    const noted = pushNote(
      working,
      "Overlap. This is the busiest window in the hourly sample.",
      working.simMinute,
    );
    working = { ...working, ...noted, toldOverlap: true };
  }
  if (ctx.trade && !working.toldNewYork && h >= 16) {
    const noted = pushNote(working, "New York. No new risk. What is open can still hit its stop or target, then the book goes flat.", working.simMinute);
    working = { ...working, ...noted, toldNewYork: true };
  }

  const sleeve = SLEEVES[ctx.risk];
  const marked = equityOf(working);
  const nightRet = working.dayOpenEquity > 0 ? (marked - working.dayOpenEquity) / working.dayOpenEquity : 0;
  if (ctx.trade && !working.halted && nightRet <= -sleeve.halt) {
    working = flattenAll(working, "Halt flat");
    const noted = pushNote(
      working,
      `Down ${Math.abs(nightRet * 100).toFixed(2)}% from the open. The book is flat. The halt is the point of the sleeve.`,
      working.simMinute,
    );
    working = { ...working, ...noted, halted: true };
  }

  const eq = equityOf(working);
  const peak = ctx.trade && eq > working.peakEquity ? eq : working.peakEquity;
  const dd = peak > 0 ? (peak - eq) / peak : 0;
  const curve = ctx.trade ? [...working.curve.slice(-399), { t: working.simMinute, v: eq }] : working.curve;
  working = {
    ...working,
    peakEquity: peak,
    maxDd: ctx.trade ? Math.max(working.maxDd, dd) : working.maxDd,
    curve,
  };

  if (ctx.trade && working.simMinute >= working.dayEnd) {
    working = flattenAll(working, "Session flat");
    const noted = pushNote(working, "21:00 UTC. Flat. Late New York is where spreads eat thin ranges.", working.simMinute);
    const endEq = equityOf(working);
    working = { ...working, ...noted, curve: [...working.curve.slice(-399), { t: working.simMinute, v: endEq }] };
    return { book: working, done: true };
  }
  return { book: working, done: false };
}

function blankAsia(): Record<PairId, number | null> {
  return mapPairs<number | null>(null);
}

function rollToNextDay(book: Book): Book {
  const midnight = book.dayStart + 1440;
  let next = book.positions.length ? flattenAll(book, "Flattened before the next day") : book;
  let guard = 0;
  const silent: StepCtx = { trade: false, enabled: SILENT_ENABLED, risk: "careful" };
  while (next.simMinute < midnight && guard < 40) {
    next = advanceBar(next, silent).book;
    guard += 1;
  }
  return {
    ...next,
    dayStart: midnight,
    dayEnd: midnight + DAY_END_HOUR * 60,
    asiaHigh: blankAsia(),
    asiaLow: blankAsia(),
    fired: [],
    skipNoted: [],
    toldLondon: false,
    toldOverlap: false,
    toldNewYork: false,
    halted: false,
  };
}

export function beginDay(book: Book, risk: RiskSleeve, salt = Date.now()): Book {
  let next = book.simMinute >= book.dayEnd ? rollToNextDay(book) : book;
  if (next.positions.length) next = flattenAll(next, "Flattened before the day");
  if (next.day === 0) next = { ...next, rng: stir(next.rng, salt) };
  const equity = equityOf(next);
  const day = next.day + 1;
  const armed: Book = {
    ...next,
    day,
    sleeve: risk,
    dayOpenEquity: equity,
    dayOpenMids: { ...next.mids },
    peakEquity: equity,
    maxDd: 0,
    halted: false,
    curve: [{ t: next.simMinute, v: equity }],
    notes: [],
    noteSeq: next.noteSeq,
    fired: [],
    skipNoted: [],
    toldLondon: false,
    toldOverlap: false,
    toldNewYork: false,
    asiaHigh: blankAsia(),
    asiaLow: blankAsia(),
  };
  const noted = pushNote(
    armed,
    `Day ${day}. Tokyo, then London, then the overlap, flat by 21:00 UTC. ${book.cent ? "Cent book — pip value is one hundredth of a standard lot." : "Standard book."} Sleeve ${SLEEVES[risk].label.toLowerCase()}.`,
    armed.simMinute,
  );
  return { ...armed, ...noted };
}

export function createOpeningBook(cash = 100, cent = true): Book {
  let book: Book = {
    cash,
    cent,
    simMinute: -20 * BAR_MINUTES,
    rng: OPENING_SEED,
    mids: mapPairs(0),
    bars: mapPairs<Bar[]>([]),
    positions: [],
    trades: [],
    notes: [],
    curve: [],
    dayOpenEquity: cash,
    dayOpenMids: mapPairs(0),
    peakEquity: cash,
    maxDd: 0,
    halted: false,
    day: 0,
    dayStart: 0,
    dayEnd: DAY_END_HOUR * 60,
    tradeSeq: 0,
    noteSeq: 0,
    sleeve: "careful",
    fired: [],
    skipNoted: [],
    asiaHigh: blankAsia(),
    asiaLow: blankAsia(),
    toldLondon: false,
    toldOverlap: false,
    toldNewYork: false,
    cooldown: mapPairs(0),
  };
  for (const id of PAIR_ORDER) book.mids[id] = PAIRS[id].start;
  book.dayOpenMids = { ...book.mids };
  const silent: StepCtx = { trade: false, enabled: SILENT_ENABLED, risk: "careful" };
  for (let i = 0; i < 20; i++) book = advanceBar(book, silent).book;
  const eq = equityOf(book);
  const intro = pushNote(
    { ...book, dayOpenEquity: eq },
    "Paper book. Run a day to rehearse Tokyo, London, and New York. Nothing here is a live order.",
    book.simMinute,
  );
  return { ...book, ...intro, dayOpenEquity: eq, dayOpenMids: { ...book.mids }, peakEquity: eq, curve: [{ t: book.simMinute, v: eq }] };
}

export function dayProgress(book: Book): number {
  const span = book.dayEnd - book.dayStart;
  if (span <= 0) return 0;
  return clamp((book.simMinute - book.dayStart) / span, 0, 1);
}

export function buildReport(book: Book): Report {
  const trades = book.trades.filter((t) => t.day === book.day);
  const endEquity = equityOf(book);
  const pnl = endEquity - book.dayOpenEquity;
  const ret = book.dayOpenEquity > 0 ? pnl / book.dayOpenEquity : 0;
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const avgR = trades.length ? trades.reduce((a, t) => a + t.rMultiple, 0) / trades.length : 0;
  let best: ClosedTrade | null = null;
  let worst: ClosedTrade | null = null;
  for (const t of trades) {
    if (!best || t.pnl > best.pnl) best = t;
    if (!worst || t.pnl < worst.pnl) worst = t;
  }
  const parts: string[] = [];
  if (trades.length === 0) {
    parts.push("Nothing cleared the spread test, so the desk stayed flat.");
  } else {
    if (book.halted) parts.push("The halt flattened the book before New York was over.");
    if (best && best.pnl > 0) parts.push(`${best.pair} ${best.side} in ${best.session} was the best fill.`);
    if (worst && worst.pnl < 0) parts.push(`${worst.pair} ${worst.side} was the drag.`);
    parts.push(pnl >= 0 ? "The paper book finished ahead of the open." : "The paper book finished down. That is a result, not a reason to raise risk.");
  }
  return {
    day: book.day,
    startEquity: book.dayOpenEquity,
    endEquity,
    pnl,
    ret,
    trades,
    wins,
    losses,
    avgR,
    best,
    worst,
    maxDd: book.maxDd,
    halted: book.halted,
    blurb: parts.join(" "),
  };
}

export function sessionLabel(minute: number): string {
  return sessionAt(minute).name;
}
