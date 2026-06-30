import React from "react";
import ReactDOM from "react-dom/client";
import { Activity, Bot, Clock, Play, RefreshCw, Shield, Trash2, WalletCards } from "lucide-react";
import type { AppLog, AppSettings, Candidate, Portfolio, RiskMode, ScanResult } from "./shared/types";
import "./styles.css";

const DEFAULT_SETTINGS: AppSettings = {
  scanIntervalMinutes: 30,
  maxCandidates: 5,
  candidateTtlHours: 24,
  initialCapital: 1000,
  orderAmount: 10,
  maxBuysPerMarket: 1,
  riskMode: "balanced",
  userPrompt: ""
};

function App() {
  const [settings, setSettings] = React.useState<AppSettings>(DEFAULT_SETTINGS);
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [portfolio, setPortfolio] = React.useState<Portfolio | null>(null);
  const [logs, setLogs] = React.useState<AppLog[]>([]);
  const [scanResult, setScanResult] = React.useState<ScanResult | null>(null);
  const [busy, setBusy] = React.useState<string>("");
  const [scheduleEnabled, setScheduleEnabled] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [candidateData, portfolioData, logData] = await Promise.all([
      api<Candidate[]>("/api/candidates"),
      api<Portfolio>(`/api/portfolio?initialCapital=${settings.initialCapital}`),
      api<AppLog[]>("/api/logs")
    ]);
    setCandidates(candidateData);
    setPortfolio(portfolioData);
    setLogs(logData);
  }, [settings.initialCapital]);

  React.useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function runAction<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    try {
      const result = await action();
      await refresh();
      return result;
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Polymarket 天气温度模拟交易系统</h1>
          <p>只读市场数据、官方天气数据、AI 决策和本地模拟账本。</p>
        </div>
        <div className="health-pill">
          <Bot size={18} />
          <span>AI 模型 gpt-5.5</span>
        </div>
      </header>

      <section className="workspace">
        <Panel title="天气数据筛选" icon={<Activity size={18} />}>
          <div className="control-grid">
            <NumberField label="定时分钟" value={settings.scanIntervalMinutes} onChange={(v) => setSettings({ ...settings, scanIntervalMinutes: v })} />
            <NumberField label="入池个数" value={settings.maxCandidates} onChange={(v) => setSettings({ ...settings, maxCandidates: v })} />
            <NumberField label="保存小时" value={settings.candidateTtlHours} onChange={(v) => setSettings({ ...settings, candidateTtlHours: v })} />
          </div>
          <div className="button-row">
            <button
              onClick={async () => {
                const result = await runAction("scan", () => api<ScanResult>("/api/scan/run", { method: "POST", body: settings }));
                if (result) setScanResult(result);
              }}
              disabled={Boolean(busy)}
            >
              <Play size={16} /> 立即运行
            </button>
            <button
              className={scheduleEnabled ? "danger" : "secondary"}
              onClick={async () => {
                const next = !scheduleEnabled;
                await runAction("schedule", () => api("/api/scan/schedule", { method: "POST", body: { enabled: next, settings } }));
                setScheduleEnabled(next);
              }}
              disabled={Boolean(busy)}
            >
              <Clock size={16} /> {scheduleEnabled ? "停止定时" : "启动定时"}
            </button>
          </div>
          <ResultSummary result={scanResult} />
          <LogList logs={logs.filter((log) => log.scope === "scan" || log.scope === "candidate" || log.scope === "ai").slice(0, 12)} />
        </Panel>

        <Panel title="候选池" icon={<Shield size={18} />}>
          <div className="pool-header">
            <strong>{candidates.length}</strong>
            <span>个候选下单选项</span>
          </div>
          <div className="candidate-list">
            {candidates.map((candidate) => (
              <article className="item-card" key={candidate.id}>
                <div className="item-title">
                  <span className={candidate.option.side === "Yes" ? "side yes" : "side no"}>{candidate.option.side}</span>
                  <strong>{candidate.option.temperatureText}</strong>
                </div>
                <p>{candidate.option.question}</p>
                <div className="metrics">
                  <span>{candidate.option.location}</span>
                  <span>{candidate.option.targetDate}</span>
                  <span>${candidate.option.price.toFixed(3)}</span>
                </div>
                <p className="reason">{candidate.aiDecision.reason}</p>
                <button className="icon-button" title="删除候选项" onClick={() => runAction("delete", () => api(`/api/candidates/${candidate.id}`, { method: "DELETE" }))}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
            {!candidates.length && <Empty text="候选池暂无数据。运行左侧扫描后，AI 会把合适的 Yes/No 选项放到这里。" />}
          </div>
        </Panel>

        <Panel title="买入持仓管理" icon={<WalletCards size={18} />}>
          <div className="control-grid">
            <NumberField label="模拟本金" value={settings.initialCapital} onChange={(v) => setSettings({ ...settings, initialCapital: v })} />
            <NumberField label="每单金额" value={settings.orderAmount} onChange={(v) => setSettings({ ...settings, orderAmount: v })} />
            <NumberField label="同市场上限" value={settings.maxBuysPerMarket} onChange={(v) => setSettings({ ...settings, maxBuysPerMarket: v })} />
          </div>
          <div className="segmented" role="group" aria-label="AI 风格">
            {(["conservative", "balanced", "aggressive"] as RiskMode[]).map((mode) => (
              <button key={mode} className={settings.riskMode === mode ? "active" : ""} onClick={() => setSettings({ ...settings, riskMode: mode })}>
                {modeName(mode)}
              </button>
            ))}
          </div>
          <label className="field stacked">
            <span>AI 提示词</span>
            <textarea value={settings.userPrompt} onChange={(event) => setSettings({ ...settings, userPrompt: event.target.value })} />
          </label>
          <div className="button-row">
            <button onClick={() => runAction("buy", () => api("/api/trading/run", { method: "POST", body: settings }))} disabled={Boolean(busy)}>
              <Bot size={16} /> AI 买入
            </button>
            <button className="secondary" onClick={() => runAction("review", () => api("/api/positions/review", { method: "POST", body: settings }))} disabled={Boolean(busy)}>
              <RefreshCw size={16} /> 复核持仓
            </button>
          </div>
          <PortfolioView portfolio={portfolio} />
          <LogList logs={logs.filter((log) => log.scope === "trade" || log.scope === "position").slice(0, 8)} />
        </Panel>
      </section>
      {busy && <div className="busy">正在执行：{busy}</div>}
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" min="1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ResultSummary({ result }: { result: ScanResult | null }) {
  if (!result) return <Empty text="等待扫描运行。" />;
  return (
    <div className="summary-grid">
      <div>
        <strong>{result.added.length}</strong>
        <span>已入池</span>
      </div>
      <div>
        <strong>{result.skipped.length}</strong>
        <span>跳过</span>
      </div>
    </div>
  );
}

function PortfolioView({ portfolio }: { portfolio: Portfolio | null }) {
  if (!portfolio) return <Empty text="正在载入组合。" />;
  return (
    <>
      <div className="summary-grid">
        <div>
          <strong>{money(portfolio.cash)}</strong>
          <span>现金</span>
        </div>
        <div>
          <strong>{money(portfolio.equity)}</strong>
          <span>权益</span>
        </div>
        <div>
          <strong className={portfolio.realizedPnl >= 0 ? "profit" : "loss"}>{money(portfolio.realizedPnl)}</strong>
          <span>已实现</span>
        </div>
        <div>
          <strong className={portfolio.unrealizedPnl >= 0 ? "profit" : "loss"}>{money(portfolio.unrealizedPnl)}</strong>
          <span>未实现</span>
        </div>
      </div>
      <div className="position-list">
        {portfolio.openPositions.map((position) => (
          <article className="item-card" key={position.id}>
            <div className="item-title">
              <span className={position.side === "Yes" ? "side yes" : "side no"}>{position.side}</span>
              <strong>{money(position.amount)}</strong>
            </div>
            <p>{position.question}</p>
            <div className="metrics">
              <span>入场 {position.entryPrice.toFixed(3)}</span>
              <span>当前 {position.currentPrice.toFixed(3)}</span>
              <span className={position.unrealizedPnl >= 0 ? "profit" : "loss"}>{money(position.unrealizedPnl)}</span>
            </div>
          </article>
        ))}
        {!portfolio.openPositions.length && <Empty text="暂无持仓。" />}
      </div>
    </>
  );
}

function LogList({ logs }: { logs: AppLog[] }) {
  return (
    <div className="logs">
      {logs.map((log) => (
        <div className={`log ${log.level}`} key={log.id}>
          <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
          <p>{log.message}</p>
        </div>
      ))}
      {!logs.length && <Empty text="暂无日志。" />}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function modeName(mode: RiskMode): string {
  return { conservative: "稳健", balanced: "均衡", aggressive: "激进" }[mode];
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
