export type RiskMode = "conservative" | "balanced" | "aggressive";
export type TradeSide = "Yes" | "No";
export type PositionStatus = "open" | "closed";
export type LogLevel = "info" | "warn" | "error" | "success";

export type AppSettings = {
  scanIntervalMinutes: number;
  maxCandidates: number;
  candidateTtlHours: number;
  initialCapital: number;
  orderAmount: number;
  maxBuysPerMarket: number;
  riskMode: RiskMode;
  userPrompt: string;
};

export type MarketOption = {
  marketId: string;
  conditionId: string;
  question: string;
  slug: string;
  eventTitle: string;
  description: string;
  targetDate: string;
  location: string;
  temperatureText: string;
  side: TradeSide;
  tokenId: string;
  price: number;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  volume: number;
  volume24hr: number;
  liquidity: number;
  spread: number | null;
  image: string;
  sourceUrl: string;
};

export type WeatherSnapshot = {
  location: string;
  targetDate: string;
  forecastSummary: string;
  forecastHighF: number | null;
  forecastLowF: number | null;
  historicalStatus: "available" | "missing-token" | "unavailable";
  historicalSamples: HistoricalSample[];
  weightedHistoricalHighF: number | null;
  weightedHistoricalLowF: number | null;
};

export type HistoricalSample = {
  year: number;
  date: string;
  highF: number | null;
  lowF: number | null;
  weight: number;
};

export type AiDecision = {
  action: "add_candidate" | "skip" | "buy" | "hold" | "sell";
  confidence: number;
  side: TradeSide | null;
  reason: string;
  riskNotes: string;
  suggestedAmount: number | null;
  marketId: string | null;
  tokenId: string | null;
};

export type Candidate = {
  id: string;
  option: MarketOption;
  weather: WeatherSnapshot;
  aiDecision: AiDecision;
  riskMode: RiskMode;
  createdAt: string;
  expiresAt: string;
};

export type Position = {
  id: string;
  candidateId: string;
  marketId: string;
  tokenId: string;
  side: TradeSide;
  question: string;
  location: string;
  targetDate: string;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  shares: number;
  status: PositionStatus;
  openedAt: string;
  closedAt: string | null;
  realizedPnl: number;
  unrealizedPnl: number;
  aiDecision: AiDecision;
};

export type Trade = {
  id: string;
  positionId: string;
  marketId: string;
  side: TradeSide;
  action: "buy" | "sell";
  price: number;
  amount: number;
  shares: number;
  pnl: number;
  createdAt: string;
  reason: string;
};

export type Portfolio = {
  cash: number;
  initialCapital: number;
  openPositions: Position[];
  closedPositions: Position[];
  trades: Trade[];
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
};

export type AppLog = {
  id: string;
  level: LogLevel;
  scope: "scan" | "candidate" | "trade" | "position" | "system" | "ai";
  message: string;
  details: unknown;
  createdAt: string;
};

export type ScanResult = {
  added: Candidate[];
  skipped: Array<{ option: MarketOption; decision: AiDecision; weather: WeatherSnapshot }>;
  logs: AppLog[];
};
