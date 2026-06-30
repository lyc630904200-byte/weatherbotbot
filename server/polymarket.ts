import type { MarketOption, TradeSide } from "../src/shared/types.js";
import { parseJsonArray, toNumber } from "./utils.js";

type GammaMarket = Record<string, unknown>;

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

const WEATHER_TERMS = [
  "temperature",
  "weather",
  "high temp",
  "low temp",
  "daily high",
  "daily low",
  "degrees",
  "fahrenheit",
  "°f",
  "nyc",
  "chicago",
  "miami",
  "austin",
  "phoenix",
  "philadelphia",
  "denver",
  "los angeles"
];

export async function discoverWeatherMarkets(limit = 80): Promise<MarketOption[]> {
  const markets = await fetchGammaMarkets(limit);
  const weatherMarkets = markets.filter(isWeatherMarket);
  const options = weatherMarkets.flatMap(marketToOptions);
  return options.sort((a, b) => b.volume24hr + b.liquidity - (a.volume24hr + a.liquidity));
}

async function fetchGammaMarkets(limit: number): Promise<GammaMarket[]> {
  const urls = [
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`,
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&tag_slug=weather`,
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&tag_slug=temperature`
  ];
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Polymarket Gamma ${response.status}`);
      const body = (await response.json()) as GammaMarket[] | { markets?: GammaMarket[]; data?: GammaMarket[] };
      return Array.isArray(body) ? body : (body.markets ?? body.data ?? []);
    })
  );
  const byId = new Map<string, GammaMarket>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const market of result.value) {
      const id = String(market.id ?? market.conditionId ?? "");
      if (id) byId.set(id, market);
    }
  }
  return [...byId.values()];
}

function isWeatherMarket(market: GammaMarket): boolean {
  const haystack = [
    market.question,
    market.title,
    market.description,
    market.slug,
    market.groupItemTitle,
    JSON.stringify(market.events ?? ""),
    JSON.stringify(market.tags ?? "")
  ]
    .join(" ")
    .toLowerCase();
  const hasWeatherTerm = WEATHER_TERMS.some((term) => haystack.includes(term));
  const hasTemperatureRange = /\b\d{2,3}\s*(?:-|to|–)\s*\d{2,3}\b/.test(haystack) || /\b\d{2,3}\+?\s*(?:degrees|°f|f)\b/.test(haystack);
  return Boolean(market.active) && !market.closed && hasWeatherTerm && hasTemperatureRange;
}

function marketToOptions(market: GammaMarket): MarketOption[] {
  const outcomes = parseJsonArray<string>(market.outcomes);
  const prices = parseJsonArray<string>(market.outcomePrices);
  const tokenIds = parseJsonArray<string>(market.clobTokenIds);
  const question = String(market.question ?? "");
  const description = String(market.description ?? "");
  const event = Array.isArray(market.events) ? (market.events[0] as Record<string, unknown> | undefined) : undefined;
  const marketId = String(market.id ?? market.conditionId ?? "");
  return outcomes
    .map((outcome, index): MarketOption | null => {
      if (outcome !== "Yes" && outcome !== "No") return null;
      const tokenId = tokenIds[index];
      if (!tokenId) return null;
      return {
        marketId,
        conditionId: String(market.conditionId ?? ""),
        question,
        slug: String(market.slug ?? ""),
        eventTitle: String(event?.title ?? market.title ?? ""),
        description,
        targetDate: String(market.endDateIso ?? String(market.endDate ?? "").slice(0, 10)),
        location: inferLocation(`${question} ${description}`),
        temperatureText: inferTemperatureText(`${question} ${description}`),
        side: outcome as TradeSide,
        tokenId,
        price: toNumber(prices[index], toNumber(market.lastTradePrice, 0.5)),
        bestBid: nullableNumber(market.bestBid),
        bestAsk: nullableNumber(market.bestAsk),
        lastTradePrice: nullableNumber(market.lastTradePrice),
        volume: toNumber(market.volumeNum ?? market.volume),
        volume24hr: toNumber(market.volume24hrClob ?? market.volume24hr),
        liquidity: toNumber(market.liquidityClob ?? market.liquidity),
        spread: nullableNumber(market.spread),
        image: String(market.image ?? market.icon ?? ""),
        sourceUrl: `https://polymarket.com/event/${event?.slug ?? market.slug ?? ""}`
      };
    })
    .filter((option): option is MarketOption => Boolean(option));
}

function nullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferLocation(text: string): string {
  const patterns = [
    /\b(?:in|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:,|\s+on|\s+by|\s+above|\s+below|\?)/,
    /\b(NYC|New York City|Chicago|Miami|Austin|Phoenix|Denver|Philadelphia|Los Angeles|Boston|Seattle|Dallas|Houston)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeLocation(match[1]);
  }
  return "New York City";
}

function normalizeLocation(location: string): string {
  const aliases: Record<string, string> = {
    NYC: "New York City"
  };
  return aliases[location] ?? location.trim();
}

function inferTemperatureText(text: string): string {
  const patterns = [
    /(?:between|from)?\s*(\d{2,3})\s*(?:-|to|–)\s*(\d{2,3})\s*(?:degrees|°F|F)?/i,
    /(above|over|below|under|at least)\s*(\d{2,3})\s*(?:degrees|°F|F)?/i,
    /(\d{2,3})\+?\s*(?:degrees|°F|F)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return "temperature range";
}

export async function getTokenPrice(tokenId: string, fallback: number): Promise<number> {
  const urls = [`${CLOB}/price?token_id=${encodeURIComponent(tokenId)}&side=buy`, `${CLOB}/midpoint?token_id=${encodeURIComponent(tokenId)}`];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = (await response.json()) as { price?: unknown; mid?: unknown; midpoint?: unknown };
      const value = toNumber(body.price ?? body.mid ?? body.midpoint, Number.NaN);
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      continue;
    }
  }
  return fallback;
}
