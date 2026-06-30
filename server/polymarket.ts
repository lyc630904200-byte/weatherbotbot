import type { MarketOption, TradeSide } from "../src/shared/types.js";
import { getJson, getText } from "./httpClient.js";
import { parseJsonArray, toNumber } from "./utils.js";

type GammaMarket = Record<string, unknown>;
type GammaEvent = Record<string, unknown> & { markets?: GammaMarket[] };

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const POLYMARKET = "https://polymarket.com";
const WEATHER_CHANNELS = ["/weather/high-temperature", "/weather/low-temperature"];
const OFFICIAL_WEATHER_EVENT_URLS = [
  `${GAMMA}/events?active=true&closed=false&limit=120&tag_slug=weather`,
  `${GAMMA}/events?active=true&closed=false&limit=120&tag_id=84`,
  `${GAMMA}/events?active=true&closed=false&limit=120&tag_slug=temperature`,
  `${GAMMA}/events?active=true&closed=false&limit=120&tag_id=104615`
];
const WEATHER_EVENT_SEEDS = [
  "highest-temperature-in-shanghai-on-july-1-2026",
  "highest-temperature-in-hong-kong-on-july-1-2026",
  "highest-temperature-in-munich-on-july-1-2026",
  "highest-temperature-in-warsaw-on-july-1-2026",
  "highest-temperature-in-tokyo-on-july-1-2026",
  "highest-temperature-in-chengdu-on-july-1-2026"
];

const WEATHER_TERMS = [
  "temperature",
  "weather",
  "high temp",
  "low temp",
  "daily high",
  "daily low",
  "degrees",
  "fahrenheit",
  "celsius",
  "nyc",
  "shanghai",
  "hong kong",
  "tokyo",
  "chengdu",
  "munich",
  "warsaw",
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
  const officialEventMarkets = await fetchOfficialWeatherEventMarkets();
  const channelMarkets = officialEventMarkets.length ? [] : await fetchWeatherChannelMarkets(limit);
  const urls = [
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&order=volume24hr&ascending=false`,
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&tag_slug=weather`,
    `${GAMMA}/markets?active=true&closed=false&limit=${limit}&tag_slug=temperature`
  ];
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const body = await getJson<GammaMarket[] | { markets?: GammaMarket[]; data?: GammaMarket[]; value?: GammaMarket[] }>(url);
      return Array.isArray(body) ? body : (body.markets ?? body.data ?? body.value ?? []);
    })
  );
  const byId = new Map<string, GammaMarket>();
  for (const market of officialEventMarkets) {
    const id = String(market.id ?? market.conditionId ?? "");
    if (id) byId.set(id, market);
  }
  for (const market of channelMarkets) {
    const id = String(market.id ?? market.conditionId ?? "");
    if (id) byId.set(id, market);
  }
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const market of result.value) {
      const id = String(market.id ?? market.conditionId ?? "");
      if (id) byId.set(id, market);
    }
  }
  return [...byId.values()];
}

async function fetchOfficialWeatherEventMarkets(): Promise<GammaMarket[]> {
  const results = await Promise.allSettled(
    OFFICIAL_WEATHER_EVENT_URLS.map(async (url) => {
      const body = await getJson<GammaEvent[] | { data?: GammaEvent[]; events?: GammaEvent[]; value?: GammaEvent[] }>(url);
      const events = Array.isArray(body) ? body : (body.events ?? body.data ?? body.value ?? []);
      return flattenEventMarkets(events);
    })
  );
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function fetchWeatherChannelMarkets(limit: number): Promise<GammaMarket[]> {
  const slugs = await fetchWeatherEventSlugs();
  const selected = slugs.slice(0, Math.max(1, Math.ceil(limit / 8)));
  const results = await Promise.allSettled(selected.map(fetchEventMarkets));
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

async function fetchWeatherEventSlugs(): Promise<string[]> {
  const slugs = new Set<string>(WEATHER_EVENT_SEEDS);
  const pages = await Promise.allSettled(
    WEATHER_CHANNELS.map(async (path) => {
      return getText(`${POLYMARKET}${path}`);
    })
  );
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    for (const match of page.value.matchAll(/\/event\/(highest-temperature-[^"'?#<\s]+|lowest-temperature-[^"'?#<\s]+)/g)) {
      slugs.add(match[1].split("/")[0]);
    }
  }
  return [...slugs];
}

async function fetchEventMarkets(slug: string): Promise<GammaMarket[]> {
  const body = await getJson<GammaEvent[] | { data?: GammaEvent[]; events?: GammaEvent[]; value?: GammaEvent[] }>(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
  const events = Array.isArray(body) ? body : (body.events ?? body.data ?? body.value ?? []);
  return flattenEventMarkets(events);
}

function flattenEventMarkets(events: GammaEvent[]): GammaMarket[] {
  return events.flatMap((event) =>
    (event.markets ?? []).map((market) => ({
      ...market,
      events: [
        {
          id: event.id,
          slug: event.slug,
          title: event.title,
          description: event.description
        }
      ]
    }))
  );
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
  const hasTemperatureRange =
    /\b\d{1,3}\s*(?:-|to)\s*\d{1,3}\b/.test(haystack) ||
    /\b\d{1,3}\+?\s*(?:degrees|f|c)\b/.test(haystack) ||
    /\b\d{1,3}\D{0,4}(?:f|c)\b/.test(haystack) ||
    /\b\d{1,3}\D{0,4}(?:f|c)\s*or\s*(?:below|above)\b/.test(haystack);
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
    /\btemperature\s+in\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3})\s+be\b/,
    /\b(?:in|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:,|\s+on|\s+by|\s+above|\s+below|\?)/,
    /\b(NYC|New York City|Shanghai|Hong Kong|Tokyo|Chengdu|Chongqing|Munich|Warsaw|Chicago|Miami|Austin|Phoenix|Denver|Philadelphia|Los Angeles|Boston|Seattle|Dallas|Houston)\b/i
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
    /(?:between|from)?\s*(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\s*(?:degrees|F|C)?/i,
    /(\d{1,3})\D{0,4}(?:F|C)\s*or\s*(below|above)/i,
    /(above|over|below|under|at least)\s*(\d{1,3})\s*(?:degrees|F|C)?/i,
    /(\d{1,3})\+?\D{0,4}(?:degrees|F|C)/i
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
      const body = await getJson<{ price?: unknown; mid?: unknown; midpoint?: unknown }>(url);
      const value = toNumber(body.price ?? body.mid ?? body.midpoint, Number.NaN);
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      continue;
    }
  }
  return fallback;
}
