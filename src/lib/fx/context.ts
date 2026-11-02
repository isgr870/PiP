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

export interface BtcBook {
  ok: boolean;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  hour: number | null;
  detail: string;
}

async function readBtcBook(host = "https://data-api.binance.vision"): Promise<BtcBook> {
  const empty = (detail: string): BtcBook => ({ ok: false, bid: null, ask: null, spread: null, hour: null, detail });
  try {
    const [bookResponse, barResponse] = await Promise.all([
      fetch(`${host}/api/v3/ticker/bookTicker?symbol=BTCUSDT`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${host}/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60`, { signal: AbortSignal.timeout(5000) }),
    ]);
    if (!bookResponse.ok || !barResponse.ok) {
      let detail = "Binance did not give a book.";
      try {
        const body = (await bookResponse.json()) as { msg?: string };
        if (body.msg) detail = body.msg;
      } catch {
        detail = "Binance did not give a book.";
      }
      return empty(detail);
    }
    const book = (await bookResponse.json()) as { bidPrice?: string; askPrice?: string };
    const bars = (await barResponse.json()) as unknown[];
    const bid = Number(book.bidPrice);
    const ask = Number(book.askPrice);
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    for (const row of bars) {
      if (!Array.isArray(row)) continue;
      high = Math.max(high, Number(row[2]));
      low = Math.min(low, Number(row[3]));
    }
    if (![bid, ask, high, low].every(Number.isFinite) || ask < bid) return empty("The tape was empty.");
    return { ok: true, bid, ask, spread: ask - bid, hour: high - low, detail: "Live tape." };
  } catch {
    return empty("Binance did not answer.");
  }
}

export const loadBinanceBook = createServerFn({ method: "GET" }).handler(async (): Promise<BtcBook> => readBtcBook());

function liveBookBlock(book: BtcBook, stop: number): string | null {
  if (!book.ok || book.spread == null || book.hour == null || book.spread <= 0 || book.hour <= 0) return book.detail;
  if (!(stop >= book.hour * 1.5)) return `Stop of ${stop} USDT is inside an hour of ${book.hour.toFixed(0)}. No order was sent.`;
  if (book.spread / stop > 0.15) return "The live spread is more than 15% of the stop. No order was sent.";
  return null;
}

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

const recentLive = new Map<string, number>();

/** Paper unless mode is testnet or mainnet and the hard gate passes. Keys are not stored. */
export const sendBinanceSpot = createServerFn({ method: "POST" })
  .validator((input: {
    symbol: string;
    quoteUsdt: number;
    stopPips: number;
    apiKey?: string;
    apiSecret?: string;
    mode?: string;
    confirm?: string;
    sender?: string;
  }) => {
    const symbol = input.symbol;
    const quoteUsdt = Number(input.quoteUsdt);
    const stopPips = Number(input.stopPips);
    const mode = input.mode === "testnet" || input.mode === "mainnet" ? input.mode : "paper";
    const confirm = (input.confirm ?? "").trim().toUpperCase();
    const sender = (input.sender ?? "").trim();
    const apiKey = (input.apiKey ?? "").trim();
    const apiSecret = (input.apiSecret ?? "").trim();
    if (symbol !== "BTCUSDT") throw new Error("This page sends BTCUSDT only.");
    if (!Number.isFinite(quoteUsdt) || quoteUsdt < 5 || quoteUsdt > 250) {
      throw new Error("One click must be between 5 and 250 USDT.");
    }
    if (!Number.isFinite(stopPips) || stopPips <= 0) throw new Error("A stop in USDT is required so the live book can refuse.");
    if (mode !== "paper") {
      if (confirm !== "SEND") throw new Error("A live order requires the word SEND.");
      const allowed = (process.env.PIP_SENDER ?? "").trim();
      if (!allowed || sender !== allowed) throw new Error("This server has no permission for that sender.");
      if (apiKey.length < 16 || apiSecret.length < 16) throw new Error("Key or secret is too short.");
    }
    return { symbol, quoteUsdt, stopPips, apiKey, apiSecret, mode, confirm, sender };
  })
  .handler(async ({ data }): Promise<BinanceSendResult> => {
    if (process.env.PIP_KILL === "1") {
      return { ok: false, detail: "Kill switch is on. No order was sent." };
    }
    const book = await readBtcBook();
    const blocked = liveBookBlock(book, data.stopPips);
    if (blocked) return { ok: false, detail: blocked };
    const tape = book.bid != null && book.ask != null && book.hour != null
      ? `Bid ${book.bid.toFixed(2)}, ask ${book.ask.toFixed(2)}, hour ${book.hour.toFixed(0)}.`
      : "";
    if (data.mode === "paper") {
      await remember({ symbol: "BTCUSDT", ok: false, detail: "paper", sender: data.sender });
      return { ok: true, detail: `Paper only. ${tape} ${data.quoteUsdt.toFixed(2)} USDT was not sent.` };
    }
    if (data.mode === "mainnet" && process.env.PIP_LIVE !== "1") {
      return { ok: false, detail: "Mainnet is off. This server does not have PIP_LIVE=1. No order was sent." };
    }
    const tag = `${data.mode}:${data.quoteUsdt.toFixed(2)}`;
    const previous = recentLive.get(tag) ?? 0;
    if (Date.now() - previous < 120000) {
      return { ok: false, detail: "Duplicate. The same size already filled in the last two minutes." };
    }
    const { createHmac } = await import("node:crypto");
    const host = data.mode === "testnet" ? "https://testnet.binance.vision" : "https://api.binance.com";
    const account = await signedBinance(host, "/api/v3/account", data.apiKey, data.apiSecret, {}, createHmac);
    if (!account.ok) return { ok: false, detail: account.detail };
    const free = usdtFree(account.body);
    if (free === null || free < data.quoteUsdt || data.quoteUsdt > free * 0.01) {
      return { ok: false, detail: "Free USDT is the ceiling. The number you typed cannot raise it. No order was sent." };
    }
    const quoteHost = data.mode === "testnet" ? host : "https://data-api.binance.vision";
    const route = await readBtcBook(quoteHost);
    const limit = await limitBuy(quoteHost, route, data.quoteUsdt);
    if (!limit.ok) return { ok: false, detail: limit.detail };
    const order = await signedBinance(
      host,
      "/api/v3/order",
      data.apiKey,
      data.apiSecret,
      { symbol: data.symbol, side: "BUY", type: "LIMIT", timeInForce: "GTC", quantity: limit.qty, price: limit.price },
      createHmac,
      "POST",
    );
    if (!order.ok) {
      await remember({ symbol: "BTCUSDT", ok: false, detail: "rejected", sender: data.sender, mode: data.mode });
      return { ok: false, detail: order.detail };
    }
    const orderId = typeof order.body.orderId === "number" ? order.body.orderId : "unknown";
    const status = typeof order.body.status === "string" ? order.body.status : "unknown";
    recentLive.set(tag, Date.now());
    await remember({ symbol: "BTCUSDT", ok: true, kind: "order", detail: `order ${orderId}`, sender: data.sender, mode: data.mode, orderId, status });
    const where = data.mode === "testnet" ? "Testnet" : "Binance mainnet";
    return { ok: true, detail: `${where} accepted a limit buy on the bid. Order ${orderId}, status ${status}. It can be cancelled.` };
  });

export const cancelBinanceSpot = createServerFn({ method: "POST" })
  .validator((input: { orderId: string; apiKey: string; apiSecret: string; mode?: string; confirm?: string; sender?: string }) => {
    const orderId = input.orderId.trim();
    const confirm = (input.confirm ?? "").trim().toUpperCase();
    const sender = (input.sender ?? "").trim();
    const mode = input.mode === "mainnet" ? "mainnet" : "testnet";
    const apiKey = input.apiKey.trim();
    const apiSecret = input.apiSecret.trim();
    if (!/^\d+$/.test(orderId)) throw new Error("Order id must be the number Binance returned.");
    if (confirm !== "CANCEL") throw new Error("Cancel requires the word CANCEL.");
    const allowed = (process.env.PIP_SENDER ?? "").trim();
    if (!allowed || sender !== allowed) throw new Error("This server has no permission for that sender.");
    if (apiKey.length < 16 || apiSecret.length < 16) throw new Error("Key or secret is too short.");
    return { orderId, apiKey, apiSecret, mode, sender };
  })
  .handler(async ({ data }): Promise<BinanceSendResult> => {
    const { createHmac } = await import("node:crypto");
    const host = data.mode === "mainnet" ? "https://api.binance.com" : "https://testnet.binance.vision";
    const order = await signedBinance(host, "/api/v3/order", data.apiKey, data.apiSecret, { symbol: "BTCUSDT", orderId: data.orderId }, createHmac, "DELETE");
    if (!order.ok) return { ok: false, detail: order.detail };
    const status = typeof order.body.status === "string" ? order.body.status : "cancelled";
    await remember({ symbol: "BTCUSDT", ok: true, detail: "cancel", sender: data.sender, orderId: data.orderId, status });
    return { ok: true, detail: `Cancelled ${data.orderId}. Status ${status}.` };
  });

function floorToStep(value: number, step: number): string {
  const count = Math.floor(value / step + 1e-9);
  const places = step.toString().includes(".") ? step.toString().split(".")[1].replace(/0+$/, "").length : 0;
  return (count * step).toFixed(places);
}

async function limitBuy(host: string, book: BtcBook, quote: number): Promise<{ ok: true; qty: string; price: string } | { ok: false; detail: string }> {
  if (!book.ok || book.bid == null) return { ok: false, detail: "The route had no bid to join." };
  try {
    const response = await fetch(`${host}/api/v3/exchangeInfo?symbol=BTCUSDT`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, detail: "The exchange did not give order rules." };
    const info = (await response.json()) as { symbols?: { filters?: { filterType?: string; stepSize?: string; tickSize?: string; minQty?: string }[] }[] };
    const filters = info.symbols?.[0]?.filters ?? [];
    const lot = filters.find((item) => item.filterType === "LOT_SIZE");
    const tick = filters.find((item) => item.filterType === "PRICE_FILTER");
    const step = Number(lot?.stepSize);
    const tickSize = Number(tick?.tickSize);
    const minQty = Number(lot?.minQty);
    if (![step, tickSize, minQty].every((value) => Number.isFinite(value) && value > 0)) return { ok: false, detail: "Order rules were unreadable." };
    const price = floorToStep(book.bid, tickSize);
    const qty = floorToStep(quote / Number(price), step);
    if (Number(qty) < minQty || Number(qty) * Number(price) < 5) return { ok: false, detail: "The limit quantity rounded below the exchange minimum." };
    return { ok: true, qty, price };
  } catch {
    return { ok: false, detail: "The exchange did not give order rules." };
  }
}

async function remember(row: Record<string, unknown>) {
  const { appendFile, mkdir } = await import("node:fs/promises");
  await mkdir(".pip", { recursive: true });
  await appendFile(".pip/orders.log", `${JSON.stringify({ ts: Date.now(), ...row })}\n`);
}

function usdtFree(body: Record<string, unknown>): number | null {
  const rows = body.balances;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { asset?: unknown; free?: unknown };
    if (item.asset === "USDT" && (typeof item.free === "string" || typeof item.free === "number")) {
      const value = Number(item.free);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

async function signedBinance(
  host: string,
  path: string,
  apiKey: string,
  apiSecret: string,
  fields: Record<string, string>,
  createHmac: typeof import("node:crypto").createHmac,
  method: "GET" | "POST" | "DELETE" = "GET",
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; detail: string }> {
  const params = new URLSearchParams({ ...fields, recvWindow: "5000", timestamp: String(Date.now()) });
  params.set("signature", createHmac("sha256", apiSecret).update(params.toString()).digest("hex"));
  try {
    const response = await fetch(`${host}${path}?${params.toString()}`, {
      method,
      headers: { "X-MBX-APIKEY": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || typeof body.code === "number") {
      return { ok: false, detail: typeof body.msg === "string" ? body.msg : "The exchange refused. No fill was confirmed." };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, detail: "The exchange did not answer. No fill was confirmed." };
  }
}
