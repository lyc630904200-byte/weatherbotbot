import type { AiDecision, Candidate, MarketOption, RiskMode, WeatherSnapshot } from "../src/shared/types.js";
import { config } from "./config.js";
import { clamp, safeJsonParse } from "./utils.js";

type AiTask = "scan" | "buy" | "review";

const FALLBACK_DECISION: AiDecision = {
  action: "skip",
  confidence: 0,
  side: null,
  reason: "AI unavailable or returned invalid JSON.",
  riskNotes: "No automatic action was taken.",
  suggestedAmount: null,
  marketId: null,
  tokenId: null
};

export async function askAiForScan(option: MarketOption, weather: WeatherSnapshot, riskMode: RiskMode): Promise<AiDecision> {
  return askAi("scan", {
    riskMode,
    instruction: "Decide whether this weather temperature option should be added to the candidate pool.",
    market: option,
    weather
  });
}

export async function askAiForBuy(
  candidates: Candidate[],
  settings: { riskMode: RiskMode; orderAmount: number; maxBuysPerMarket: number; userPrompt: string }
): Promise<AiDecision[]> {
  const decision = await askAi("buy", {
    instruction: "Pick candidates to simulate-buy. Return either one decision object or an array of decision objects.",
    settings,
    candidates
  });
  return [decision].filter((item) => item.action === "buy");
}

export async function askAiForPositionReview(payload: unknown): Promise<AiDecision> {
  return askAi("review", {
    instruction: "Decide whether the open simulated position should be held or sold.",
    payload
  });
}

async function askAi(task: AiTask, payload: unknown): Promise<AiDecision> {
  if (!config.aiApiKey) {
    return { ...FALLBACK_DECISION, reason: "AI_API_KEY is not configured." };
  }
  const response = await fetch(`${config.aiBaseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: [
        {
          role: "system",
          content: [
            "You are a cautious simulated prediction-market trading analyst.",
            "This is paper trading only. Never claim real trades were made.",
            "Return strict JSON only, no markdown.",
            "Schema: {\"action\":\"add_candidate|skip|buy|hold|sell\",\"confidence\":0-1,\"side\":\"Yes|No|null\",\"reason\":\"short reason\",\"riskNotes\":\"short risk notes\",\"suggestedAmount\":number|null,\"marketId\":\"string|null\",\"tokenId\":\"string|null\"}.",
            riskPolicy(task)
          ].join("\n")
        },
        { role: "user", content: JSON.stringify(payload) }
      ],
      max_tokens: 700
    })
  });
  if (!response.ok) {
    return { ...FALLBACK_DECISION, reason: `AI request failed: ${response.status}` };
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = String(body?.choices?.[0]?.message?.content ?? "");
  const parsed = parseDecision(text);
  return parsed ?? { ...FALLBACK_DECISION, reason: "AI returned invalid JSON.", riskNotes: text.slice(0, 240) };
}

function parseDecision(text: string): AiDecision | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const parsed = safeJsonParse<unknown>(cleaned, null);
  const raw = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<AiDecision>;
  const action = obj.action;
  if (!action || !["add_candidate", "skip", "buy", "hold", "sell"].includes(action)) return null;
  return {
    action,
    confidence: clamp(Number(obj.confidence ?? 0), 0, 1),
    side: obj.side === "Yes" || obj.side === "No" ? obj.side : null,
    reason: String(obj.reason ?? ""),
    riskNotes: String(obj.riskNotes ?? ""),
    suggestedAmount: obj.suggestedAmount === null || obj.suggestedAmount === undefined ? null : Number(obj.suggestedAmount),
    marketId: obj.marketId ? String(obj.marketId) : null,
    tokenId: obj.tokenId ? String(obj.tokenId) : null
  };
}

function riskPolicy(task: AiTask): string {
  if (task === "scan") return "For scan, use action add_candidate only when market data and weather evidence are coherent.";
  if (task === "buy") return "For buy, respect max buys per market and fixed order amount. Skip low-liquidity or unclear markets.";
  return "For review, sell only when market price or weather evidence materially worsens; otherwise hold.";
}
