import { createServerFn } from "@tanstack/react-start";
import type { CalEvent } from "./analysis";

export interface Quote {
  pair: string;
  mid: number;
}

export interface DeskContext {
  asOf: string | null;
  offline: boolean;
  quotes: Quote[];
  events: CalEvent[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function quotesFromUsd(usd: Record<string, unknown>, date: string | null): { asOf: string | null; quotes: Quote[] } {
  const eur = num(usd.eur);
  const gbp = num(usd.gbp);
  const jpy = num(usd.jpy);
  const aud = num(usd.aud);
  const cad = num(usd.cad);
  const chf = num(usd.chf);
  const nzd = num(usd.nzd);
  const xau = num(usd.xau);
  const btc = num(usd.btc);
  const quotes: Quote[] = [];
  if (eur) quotes.push({ pair: "EURUSD", mid: 1 / eur });
  if (gbp) quotes.push({ pair: "GBPUSD", mid: 1 / gbp });
  if (jpy) quotes.push({ pair: "USDJPY", mid: jpy });
  if (aud) quotes.push({ pair: "AUDUSD", mid: 1 / aud });
  if (cad) quotes.push({ pair: "USDCAD", mid: cad });
  if (chf) quotes.push({ pair: "USDCHF", mid: chf });
  if (nzd) quotes.push({ pair: "NZDUSD", mid: 1 / nzd });
  if (xau) quotes.push({ pair: "XAUUSD", mid: 1 / xau });
  if (btc) quotes.push({ pair: "BTCUSD", mid: 1 / btc });
  return { asOf: date, quotes };
}

async function loadQuotes(): Promise<{ asOf: string | null; quotes: Quote[] }> {
  const response = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return { asOf: null, quotes: [] };
  const body = (await response.json()) as { date?: string; usd?: Record<string, unknown> };
  if (!body.usd) return { asOf: null, quotes: [] };
  return quotesFromUsd(body.usd, body.date ?? null);
}

async function loadEvents(): Promise<CalEvent[]> {
  const response = await fetch("https://showmytrades.com/api/public/calendar/v1?currency=USD,EUR,GBP,JPY,AUD,NZD,CAD,CHF&impact=high&days=3", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { events?: unknown[] };
  if (!Array.isArray(body.events)) return [];
  const events: CalEvent[] = [];
  for (const row of body.events) {
    if (!row || typeof row !== "object") continue;
    const item = row as { time?: unknown; currency?: unknown; title?: unknown; forecast?: unknown };
    if (typeof item.time !== "string" || typeof item.currency !== "string" || typeof item.title !== "string") continue;
    events.push({
      time: item.time,
      currency: item.currency,
      title: item.title,
      forecast: typeof item.forecast === "string" ? item.forecast : "",
    });
  }
  return events;
}

export const loadBinancePublic = createServerFn({ method: "GET" }).handler(async (): Promise<{ ok: boolean; symbol: string; price: number | null }> => {
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ok: false, symbol: "BTCUSDT", price: null };
    const body = (await response.json()) as { price?: string };
    const price = body.price ? Number(body.price) : NaN;
    return { ok: Number.isFinite(price), symbol: "BTCUSDT", price: Number.isFinite(price) ? price : null };
  } catch {
    return { ok: false, symbol: "BTCUSDT", price: null };
  }
});

export const loadDeskContext = createServerFn({ method: "GET" }).handler(async (): Promise<DeskContext> => {
  const [quotesResult, eventsResult] = await Promise.allSettled([loadQuotes(), loadEvents()]);
  const quotes = quotesResult.status === "fulfilled" ? quotesResult.value : { asOf: null, quotes: [] };
  const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
  return {
    asOf: quotes.asOf,
    offline: quotes.quotes.length === 0 && events.length === 0,
    quotes: quotes.quotes,
    events,
  };
});

export interface BinanceSendResult {
  ok: boolean;
  detail: string;
}

/** One Binance spot market buy. Keys are used for this request only and are not stored. */
export const sendBinanceSpot = createServerFn({ method: "POST" })
  .validator((input: { symbol: string; quoteUsdt: number; apiKey: string; apiSecret: string }) => {
    const symbol = input.symbol;
    const quoteUsdt = Number(input.quoteUsdt);
    const apiKey = input.apiKey.trim();
    const apiSecret = input.apiSecret.trim();
    if (symbol !== "BTCUSDT") throw new Error("This page sends BTCUSDT only.");
    if (!Number.isFinite(quoteUsdt) || quoteUsdt < 5 || quoteUsdt > 250) {
      throw new Error("One click must be between 5 and 250 USDT.");
    }
    if (apiKey.length < 16 || apiSecret.length < 16) throw new Error("Key or secret is too short.");
    return { symbol, quoteUsdt, apiKey, apiSecret };
  })
  .handler(async ({ data }): Promise<BinanceSendResult> => {
    const { createHmac } = await import("node:crypto");
    const params = new URLSearchParams({
      symbol: data.symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: data.quoteUsdt.toFixed(2),
      recvWindow: "5000",
      timestamp: String(Date.now()),
    });
    const signature = createHmac("sha256", data.apiSecret).update(params.toString()).digest("hex");
    params.set("signature", signature);
    try {
      const response = await fetch(`https://api.binance.com/api/v3/order?${params.toString()}`, {
        method: "POST",
        headers: { "X-MBX-APIKEY": data.apiKey },
        signal: AbortSignal.timeout(8000),
      });
      const body = (await response.json()) as { orderId?: number; msg?: string; code?: number };
      if (!response.ok || body.code) {
        return { ok: false, detail: body.msg || "Binance refused the order." };
      }
      return { ok: true, detail: `Binance accepted a market buy. Order ${body.orderId}.` };
    } catch {
      return { ok: false, detail: "Binance did not answer. No fill was confirmed." };
    }
  });
