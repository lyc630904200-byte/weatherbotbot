import type { AppSettings, Candidate, Position, Trade } from "../src/shared/types.js";
import { addLog, deleteCandidate, getPortfolio, insertPosition, insertTrade, listCandidates, listPositions, updatePosition } from "./db.js";
import { askAiForBuy, askAiForPositionReview } from "./ai.js";
import { getTokenPrice } from "./polymarket.js";
import { id, nowIso } from "./utils.js";

export async function runBuyCycle(settings: AppSettings): Promise<Position[]> {
  const candidates = listCandidates();
  if (!candidates.length) {
    addLog({ level: "warn", scope: "trade", message: "候选池为空，未执行买入。", details: null });
    return [];
  }
  const decisions = await askAiForBuy(candidates, settings);
  const created: Position[] = [];
  for (const decision of decisions) {
    const candidate = pickCandidate(candidates, decision);
    if (!candidate) continue;
    if (created.length >= settings.maxBuysPerMarket) break;
    const existingCount = listPositions().filter((p) => p.marketId === candidate.option.marketId && p.status === "open").length;
    if (existingCount >= settings.maxBuysPerMarket) {
      addLog({ level: "warn", scope: "trade", message: "同一市场持仓数量已达上限。", details: { marketId: candidate.option.marketId } });
      continue;
    }
    const price = await getTokenPrice(candidate.option.tokenId, candidate.option.price || 0.5);
    const amount = Math.max(1, settings.orderAmount);
    const shares = amount / Math.max(price, 0.01);
    const position: Position = {
      id: id("pos"),
      candidateId: candidate.id,
      marketId: candidate.option.marketId,
      tokenId: candidate.option.tokenId,
      side: candidate.option.side,
      question: candidate.option.question,
      location: candidate.option.location,
      targetDate: candidate.option.targetDate,
      entryPrice: price,
      currentPrice: price,
      amount,
      shares,
      status: "open",
      openedAt: nowIso(),
      closedAt: null,
      realizedPnl: 0,
      unrealizedPnl: 0,
      aiDecision: decision
    };
    insertPosition(position);
    insertTrade(makeTrade(position, "buy", 0, decision.reason));
    deleteCandidate(candidate.id);
    addLog({ level: "success", scope: "trade", message: "AI 已执行模拟买入。", details: { positionId: position.id, question: position.question } });
    created.push(position);
  }
  if (!created.length) {
    addLog({ level: "info", scope: "trade", message: "AI 未选择任何候选项买入。", details: decisions });
  }
  return created;
}

export async function reviewPositions(settings: AppSettings): Promise<Position[]> {
  const positions = listPositions().filter((position) => position.status === "open");
  const updated: Position[] = [];
  for (const position of positions) {
    const price = await getTokenPrice(position.tokenId, position.currentPrice);
    const unrealizedPnl = (price - position.entryPrice) * position.shares;
    const decision = await askAiForPositionReview({ position: { ...position, currentPrice: price, unrealizedPnl }, settings });
    const next: Position = { ...position, currentPrice: price, unrealizedPnl, aiDecision: decision };
    if (decision.action === "sell") {
      next.status = "closed";
      next.closedAt = nowIso();
      next.realizedPnl = unrealizedPnl;
      next.unrealizedPnl = 0;
      insertTrade(makeTrade(next, "sell", unrealizedPnl, decision.reason));
      addLog({ level: "success", scope: "position", message: "AI 已执行模拟卖出。", details: { positionId: next.id, pnl: unrealizedPnl } });
    } else {
      addLog({ level: "info", scope: "position", message: "AI 建议继续持有。", details: { positionId: next.id, pnl: unrealizedPnl, reason: decision.reason } });
    }
    updatePosition(next);
    updated.push(next);
  }
  return updated;
}

export function portfolio(settings: Pick<AppSettings, "initialCapital">) {
  return getPortfolio(settings.initialCapital);
}

function pickCandidate(candidates: Candidate[], decision: { marketId: string | null; tokenId: string | null }): Candidate | null {
  return (
    candidates.find((candidate) => candidate.option.tokenId === decision.tokenId) ??
    candidates.find((candidate) => candidate.option.marketId === decision.marketId) ??
    candidates[0] ??
    null
  );
}

function makeTrade(position: Position, action: Trade["action"], pnl: number, reason: string): Trade {
  return {
    id: id("trade"),
    positionId: position.id,
    marketId: position.marketId,
    side: position.side,
    action,
    price: position.currentPrice,
    amount: position.amount,
    shares: position.shares,
    pnl,
    createdAt: nowIso(),
    reason
  };
}
