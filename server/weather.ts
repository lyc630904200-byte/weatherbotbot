import type { HistoricalSample, MarketOption, WeatherSnapshot } from "../src/shared/types.js";
import { config } from "./config.js";

const LOCATION_POINTS: Record<string, { lat: number; lon: number; station?: string }> = {
  "New York City": { lat: 40.7128, lon: -74.006, station: "GHCND:USW00094728" },
  Chicago: { lat: 41.8781, lon: -87.6298, station: "GHCND:USW00094846" },
  Miami: { lat: 25.7617, lon: -80.1918, station: "GHCND:USW00012839" },
  Austin: { lat: 30.2672, lon: -97.7431, station: "GHCND:USW00013958" },
  Phoenix: { lat: 33.4484, lon: -112.074, station: "GHCND:USW00023183" },
  Denver: { lat: 39.7392, lon: -104.9903, station: "GHCND:USW00003017" },
  Philadelphia: { lat: 39.9526, lon: -75.1652, station: "GHCND:USW00013739" },
  "Los Angeles": { lat: 34.0522, lon: -118.2437, station: "GHCND:USW00093134" },
  Boston: { lat: 42.3601, lon: -71.0589, station: "GHCND:USW00014739" },
  Seattle: { lat: 47.6062, lon: -122.3321, station: "GHCND:USW00024233" },
  Dallas: { lat: 32.7767, lon: -96.797, station: "GHCND:USW00003927" },
  Houston: { lat: 29.7604, lon: -95.3698, station: "GHCND:USW00012960" }
};

export async function getWeatherSnapshot(option: MarketOption): Promise<WeatherSnapshot> {
  const point = LOCATION_POINTS[option.location] ?? LOCATION_POINTS["New York City"];
  const forecast = await getNwsForecast(point.lat, point.lon, option.targetDate);
  const historical = await getHistoricalSamples(option.location, option.targetDate, point.station);
  return {
    location: option.location,
    targetDate: option.targetDate,
    forecastSummary: forecast.summary,
    forecastHighF: forecast.highF,
    forecastLowF: forecast.lowF,
    historicalStatus: historical.status,
    historicalSamples: historical.samples,
    weightedHistoricalHighF: weightedAverage(historical.samples.map((s) => [s.highF, s.weight])),
    weightedHistoricalLowF: weightedAverage(historical.samples.map((s) => [s.lowF, s.weight]))
  };
}

async function getNwsForecast(lat: number, lon: number, targetDate: string): Promise<{ summary: string; highF: number | null; lowF: number | null }> {
  try {
    const headers = { "User-Agent": config.nwsUserAgent, Accept: "application/geo+json" };
    const pointResponse = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers });
    if (!pointResponse.ok) throw new Error(`NWS point ${pointResponse.status}`);
    const point = (await pointResponse.json()) as { properties?: { forecast?: string } };
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) throw new Error("NWS forecast url missing");
    const forecastResponse = await fetch(forecastUrl, { headers });
    if (!forecastResponse.ok) throw new Error(`NWS forecast ${forecastResponse.status}`);
    const forecast = (await forecastResponse.json()) as { properties?: { periods?: Array<Record<string, unknown>> } };
    const periods = (forecast?.properties?.periods ?? []) as Array<Record<string, unknown>>;
    const matching = periods.filter((period) => String(period.startTime ?? "").slice(0, 10) === targetDate);
    const relevant = matching.length > 0 ? matching : periods.slice(0, 4);
    const temps = relevant.map((p) => Number(p.temperature)).filter(Number.isFinite);
    return {
      summary: relevant.map((p) => `${p.name}: ${p.shortForecast}, ${p.temperature}F`).join(" | ") || "No NWS forecast period found",
      highF: temps.length ? Math.max(...temps) : null,
      lowF: temps.length ? Math.min(...temps) : null
    };
  } catch (error) {
    return {
      summary: error instanceof Error ? error.message : "NWS forecast unavailable",
      highF: null,
      lowF: null
    };
  }
}

async function getHistoricalSamples(
  location: string,
  targetDate: string,
  station?: string
): Promise<{ status: WeatherSnapshot["historicalStatus"]; samples: HistoricalSample[] }> {
  if (!config.noaaToken) return { status: "missing-token", samples: [] };
  if (!station) return { status: "unavailable", samples: [] };
  const target = new Date(`${targetDate}T00:00:00Z`);
  const monthDay = targetDate.slice(5);
  const currentYear = target.getUTCFullYear();
  const samples: HistoricalSample[] = [];
  for (let yearsBack = 1; yearsBack <= 10; yearsBack += 1) {
    const year = currentYear - yearsBack;
    const date = `${year}-${monthDay}`;
    try {
      const params = new URLSearchParams({
        datasetid: "GHCND",
        stationid: station,
        startdate: date,
        enddate: date,
        datatypeid: "TMAX,TMIN",
        units: "standard",
        limit: "100"
      });
      const response = await fetch(`https://www.ncei.noaa.gov/cdo-web/api/v2/data?${params.toString()}`, {
        headers: { token: config.noaaToken }
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { results?: Array<Record<string, unknown>> };
      const rows = (body?.results ?? []) as Array<Record<string, unknown>>;
      samples.push({
        year,
        date,
        highF: pickDatatype(rows, "TMAX"),
        lowF: pickDatatype(rows, "TMIN"),
        weight: 1 / yearsBack
      });
    } catch {
      continue;
    }
  }
  return { status: samples.length ? "available" : "unavailable", samples };
}

function pickDatatype(rows: Array<Record<string, unknown>>, datatype: string): number | null {
  const row = rows.find((item) => item.datatype === datatype);
  const value = Number(row?.value);
  return Number.isFinite(value) ? value : null;
}

function weightedAverage(values: Array<[number | null, number]>): number | null {
  const usable = values.filter((item): item is [number, number] => item[0] !== null && Number.isFinite(item[0]));
  if (!usable.length) return null;
  const weight = usable.reduce((sum, [, w]) => sum + w, 0);
  return usable.reduce((sum, [value, w]) => sum + value * w, 0) / weight;
}
