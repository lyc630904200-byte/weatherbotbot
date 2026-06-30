import type { AppSettings, Candidate, ScanResult } from "../src/shared/types.js";
import { askAiForScan } from "./ai.js";
import { addLog, listLogs, upsertCandidate } from "./db.js";
import { discoverWeatherMarkets } from "./polymarket.js";
import { getWeatherSnapshot } from "./weather.js";
import { addHours, id, nowIso } from "./utils.js";

let timer: NodeJS.Timeout | null = null;

export async function runScan(settings: AppSettings): Promise<ScanResult> {
  addLog({ level: "info", scope: "scan", message: "开始扫描 Polymarket 天气温度市场。", details: settings });
  const added: Candidate[] = [];
  const skipped: ScanResult["skipped"] = [];
  try {
    const options = await discoverWeatherMarkets(120);
    addLog({ level: "info", scope: "scan", message: `发现 ${options.length} 个潜在天气温度下单选项。`, details: null });
    for (const option of options) {
      if (added.length >= settings.maxCandidates) break;
      const weather = await getWeatherSnapshot(option);
      const decision = await askAiForScan(option, weather, settings.riskMode);
      if (decision.action === "add_candidate" && decision.confidence >= confidenceFloor(settings.riskMode)) {
        const candidate: Candidate = {
          id: id("cand"),
          option,
          weather,
          aiDecision: decision,
          riskMode: settings.riskMode,
          createdAt: nowIso(),
          expiresAt: addHours(new Date(), settings.candidateTtlHours).toISOString()
        };
        upsertCandidate(candidate);
        added.push(candidate);
        addLog({ level: "success", scope: "candidate", message: "AI 已加入候选池。", details: { question: option.question, side: option.side, reason: decision.reason } });
      } else {
        skipped.push({ option, weather, decision });
      }
    }
    if (!options.length) {
      addLog({ level: "warn", scope: "scan", message: "未发现符合规则的天气温度市场。", details: null });
    }
  } catch (error) {
    addLog({ level: "error", scope: "scan", message: "扫描失败。", details: error instanceof Error ? error.message : error });
  }
  return { added, skipped, logs: listLogs(80) };
}

export function setScanSchedule(settings: AppSettings, enabled: boolean): { enabled: boolean; intervalMinutes: number } {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (enabled) {
    const intervalMs = Math.max(1, settings.scanIntervalMinutes) * 60 * 1000;
    timer = setInterval(() => {
      void runScan(settings);
    }, intervalMs);
    addLog({ level: "success", scope: "scan", message: "定时扫描已启动。", details: { intervalMinutes: settings.scanIntervalMinutes } });
  } else {
    addLog({ level: "info", scope: "scan", message: "定时扫描已停止。", details: null });
  }
  return { enabled: Boolean(timer), intervalMinutes: settings.scanIntervalMinutes };
}

function confidenceFloor(mode: AppSettings["riskMode"]): number {
  if (mode === "conservative") return 0.72;
  if (mode === "balanced") return 0.58;
  return 0.45;
}
