/** Published hourly bid ranges, 14 Jul 2010 – 27 Jul 2026.
 *  Session buckets are the study's own UTC windows.
 *  USDCHF and NZDUSD are desk estimates, not that table.
 *  Figures describe the past. They are not a forecast.
 */

export const PAIR_ORDER = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "EURJPY",
] as const;

export type PairId = (typeof PAIR_ORDER)[number];

export interface PairSpec {
  id: PairId;
  name: string;
  base: string;
  quote: string;
  pip: number;
  /** Typical standard-account spread in pips, before the session multiplier. */
  spreadPips: number;
  start: number;
  /** True when the hourly grid is estimated rather than taken from the study. */
  estimated: boolean;
}

export const PAIRS: Record<PairId, PairSpec> = {
  EURUSD: { id: "EURUSD", name: "Euro", base: "EUR", quote: "USD", pip: 0.0001, spreadPips: 1.0, start: 1.0862, estimated: false },
  GBPUSD: { id: "GBPUSD", name: "Sterling", base: "GBP", quote: "USD", pip: 0.0001, spreadPips: 1.3, start: 1.2944, estimated: false },
  USDJPY: { id: "USDJPY", name: "Yen", base: "USD", quote: "JPY", pip: 0.01, spreadPips: 1.1, start: 149.62, estimated: false },
  USDCHF: { id: "USDCHF", name: "Swiss", base: "USD", quote: "CHF", pip: 0.0001, spreadPips: 1.4, start: 0.8648, estimated: true },
  AUDUSD: { id: "AUDUSD", name: "Aussie", base: "AUD", quote: "USD", pip: 0.0001, spreadPips: 1.2, start: 0.6612, estimated: false },
  USDCAD: { id: "USDCAD", name: "Loonie", base: "USD", quote: "CAD", pip: 0.0001, spreadPips: 1.5, start: 1.3815, estimated: false },
  NZDUSD: { id: "NZDUSD", name: "Kiwi", base: "NZD", quote: "USD", pip: 0.0001, spreadPips: 1.8, start: 0.5988, estimated: true },
  EURJPY: { id: "EURJPY", name: "Euro-Yen", base: "EUR", quote: "JPY", pip: 0.01, spreadPips: 1.8, start: 162.52, estimated: false },
};

/** Average hourly bid range in pips, hours 0–23 UTC. Study integers, except estimated pairs. */
export const HOURLY_PIPS: Record<PairId, readonly number[]> = {
  EURUSD: [14, 13, 11, 10, 9, 11, 17, 22, 22, 20, 18, 18, 25, 27, 28, 24, 19, 16, 16, 14, 11, 8, 8, 9],
  GBPUSD: [15, 15, 13, 11, 11, 13, 21, 28, 31, 28, 25, 25, 30, 31, 33, 30, 23, 19, 18, 16, 13, 12, 11, 11],
  USDJPY: [22, 20, 16, 14, 14, 14, 18, 20, 20, 17, 15, 15, 24, 25, 25, 22, 17, 15, 15, 14, 12, 11, 12, 14],
  USDCHF: [11, 10, 9, 8, 7, 9, 14, 18, 18, 16, 14, 14, 20, 22, 22, 19, 15, 13, 13, 11, 9, 6, 6, 7],
  AUDUSD: [17, 19, 14, 13, 12, 12, 15, 18, 17, 15, 14, 14, 18, 20, 22, 19, 15, 13, 14, 12, 10, 10, 10, 11],
  USDCAD: [12, 13, 11, 9, 8, 10, 13, 17, 17, 16, 15, 16, 24, 27, 29, 26, 20, 17, 17, 15, 14, 12, 9, 9],
  NZDUSD: [16, 18, 13, 12, 11, 11, 14, 17, 16, 14, 13, 13, 17, 19, 21, 18, 14, 12, 13, 11, 10, 10, 10, 10],
  EURJPY: [25, 23, 19, 17, 16, 18, 23, 30, 30, 26, 23, 23, 29, 31, 32, 28, 22, 19, 18, 16, 15, 14, 15, 17],
};

export type SessionId = "tokyo" | "london" | "overlap" | "newyork" | "late";

export interface SessionFact {
  id: SessionId;
  name: string;
  /** Inclusive start hour, exclusive end, UTC. */
  startHour: number;
  endHour: number;
  /** What this desk is allowed to do there. */
  rule: string;
  pairs: readonly PairId[];
  /** Study session average for EURUSD, pips per hour. */
  eurusdPips: number;
}

export const SESSIONS: readonly SessionFact[] = [
  {
    id: "tokyo",
    name: "Tokyo",
    startHour: 0,
    endHour: 7,
    eurusdPips: 13.3,
    pairs: ["USDJPY", "AUDUSD", "NZDUSD", "EURJPY"],
    rule: "Fade a stretch on yen, Aussie, and kiwi only. Euro is usually too quiet for the spread.",
  },
  {
    id: "london",
    name: "London",
    startHour: 7,
    endHour: 12,
    eurusdPips: 20.3,
    pairs: ["EURUSD", "GBPUSD", "USDCHF"],
    rule: "One break of the Asia range on euro, sterling, or swiss. Many breaks fail. The desk counts them.",
  },
  {
    id: "overlap",
    name: "London / New York",
    startHour: 12,
    endHour: 16,
    eurusdPips: 26.1,
    pairs: ["EURUSD", "GBPUSD", "USDJPY", "USDCAD"],
    rule: "Highest range in the 2010–2026 sample, on every major measured. Trade small, or do not trade.",
  },
  {
    id: "newyork",
    name: "New York",
    startHour: 16,
    endHour: 21,
    eurusdPips: 15.1,
    pairs: [],
    rule: "No new risk. Manage what is open, then flat. The sample quiets after 21:00 UTC.",
  },
  {
    id: "late",
    name: "Late New York",
    startHour: 21,
    endHour: 24,
    eurusdPips: 8.6,
    pairs: [],
    rule: "Dead. Spreads widen where the range is thinnest. The desk is off.",
  },
];

export const STUDY_LINE =
  "Hourly bid ranges, 14 Jul 2010 – 27 Jul 2026. Spreads are not in those ranges, and they widen in the quiet hours. Past ranges are not a forecast.";

export const EAT_OFFSET_HOURS = 3;

export function mapPairs<T>(value: T): Record<PairId, T> {
  const out = {} as Record<PairId, T>;
  for (const id of PAIR_ORDER) out[id] = value;
  return out;
}

export function hourOf(minute: number): number {
  const dm = ((minute % 1440) + 1440) % 1440;
  return dm / 60;
}

export function clockUtc(minute: number): string {
  const dm = ((minute % 1440) + 1440) % 1440;
  const h = Math.floor(dm / 60);
  const m = Math.floor(dm % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} UTC`;
}

export function clockEat(minute: number): string {
  return clockUtc(minute + EAT_OFFSET_HOURS * 60).replace(" UTC", " EAT");
}

export function sessionAt(minute: number): SessionFact {
  const h = Math.floor(hourOf(minute));
  return SESSIONS.find((s) => h >= s.startHour && h < s.endHour) ?? SESSIONS[4];
}

export function eatRange(startHour: number, endHour: number): string {
  const a = clockEat(startHour * 60);
  const b = clockEat(endHour * 60);
  return `${a.replace(" EAT", "")}–${b}`;
}

function nthSunday(year: number, monthIndex: number, n: number): number {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const dow = first.getUTCDay();
  return 1 + ((7 - dow) % 7) + (n - 1) * 7;
}

function lastSunday(year: number, monthIndex: number): number {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

/** 1 during BST, 0 during GMT. */
export function londonBst(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 2, lastSunday(y, 2), 1, 0, 0);
  const end = Date.UTC(y, 9, lastSunday(y, 9), 1, 0, 0);
  const t = date.getTime();
  return t >= start && t < end ? 1 : 0;
}

/** UTC offset of New York: −4 EDT, −5 EST. */
export function newYorkOffset(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 7, 0, 0);
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 6, 0, 0);
  const t = date.getTime();
  return t >= start && t < end ? -4 : -5;
}

export function localOpenEat(date: Date): { london: string; newYork: string; tokyo: string } {
  const bst = londonBst(date);
  const ny = newYorkOffset(date);
  const londonUtcMin = (8 - bst) * 60;
  const nyUtcMin = (8 - ny) * 60;
  return {
    tokyo: "03:00 EAT",
    london: clockEat(londonUtcMin),
    newYork: clockEat(nyUtcMin),
  };
}

export function formatPx(pair: PairId, px: number): string {
  return px.toFixed(PAIRS[pair].quote === "JPY" ? 3 : 5);
}

export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function signedUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n > 0.004) return `+${abs}`;
  if (n < -0.004) return `−${abs}`;
  return abs;
}

export function signedPct(n: number): string {
  const body = `${Math.abs(n * 100).toFixed(2)}%`;
  if (n > 0.00005) return `+${body}`;
  if (n < -0.00005) return `−${body}`;
  return body;
}

export function formatR(n: number): string {
  const body = `${Math.abs(n).toFixed(2)}R`;
  if (n > 0.004) return `+${body}`;
  if (n < -0.004) return `−${body}`;
  return body;
}

export type RiskSleeve = "careful" | "standard" | "firm";

export const SLEEVES: Record<
  RiskSleeve,
  { label: string; detail: string; pct: number; maxPos: number; halt: number; budget: number }
> = {
  careful: {
    label: "Careful",
    detail: "0.25% per trade · 2 positions · halt −1.5% · up to 5 trades",
    pct: 0.0025,
    maxPos: 2,
    halt: 0.015,
    budget: 5,
  },
  standard: {
    label: "Standard",
    detail: "0.5% per trade · 3 positions · halt −3% · up to 7 trades",
    pct: 0.005,
    maxPos: 3,
    halt: 0.03,
    budget: 7,
  },
  firm: {
    label: "Firm",
    detail: "1% per trade · 3 positions · halt −5% · up to 9 trades. This is how small books die.",
    pct: 0.01,
    maxPos: 3,
    halt: 0.05,
    budget: 9,
  },
};

export const ZONES = [
  { id: "Africa/Kampala", city: "Kampala" },
  { id: "Africa/Lagos", city: "Lagos" },
  { id: "Europe/London", city: "London" },
  { id: "America/New_York", city: "New York" },
  { id: "Asia/Dubai", city: "Dubai" },
  { id: "Asia/Singapore", city: "Singapore" },
  { id: "Asia/Tokyo", city: "Tokyo" },
  { id: "UTC", city: "UTC" },
] as const;

export function formatZone(date: Date, timeZone: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", ...options }).format(date);
}

/** Label a UTC minute-of-day in the trader's zone, using today's offset. */
export function zoneClock(utcMinute: number, timeZone: string, on: Date): string {
  const minute = ((utcMinute % 1440) + 1440) % 1440;
  const stamp = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), Math.floor(minute / 60), minute % 60));
  return formatZone(stamp, timeZone, { hour: "2-digit", minute: "2-digit" });
}

export function zoneSpan(startHour: number, endHour: number, timeZone: string, on: Date): string {
  return `${zoneClock(startHour * 60, timeZone, on)}–${zoneClock(endHour * 60, timeZone, on)}`;
}

export const BOOK_PRESETS = [
  { cash: 100, cent: true, label: "$100 cent" },
  { cash: 100, cent: false, label: "$100 standard" },
  { cash: 500, cent: true, label: "$500 cent" },
  { cash: 10000, cent: false, label: "$10,000" },
] as const;
