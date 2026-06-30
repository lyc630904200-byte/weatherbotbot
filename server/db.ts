import fs from "node:fs";
import path from "node:path";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type { AppLog, Candidate, Portfolio, Position, Trade } from "../src/shared/types.js";
import { config } from "./config.js";
import { id, nowIso, safeJsonParse } from "./utils.js";

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

export async function initDb(): Promise<Database> {
  if (db) return db;
  SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  if (fs.existsSync(config.databasePath)) {
    db = new SQL.Database(fs.readFileSync(config.databasePath));
  } else {
    db = new SQL.Database();
  }
  migrate(db);
  saveDb();
  return db;
}

function migrate(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      option_json TEXT NOT NULL,
      weather_json TEXT NOT NULL,
      ai_json TEXT NOT NULL,
      risk_mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      side TEXT NOT NULL,
      question TEXT NOT NULL,
      location TEXT NOT NULL,
      target_date TEXT NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL NOT NULL,
      amount REAL NOT NULL,
      shares REAL NOT NULL,
      status TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      realized_pnl REAL NOT NULL,
      unrealized_pnl REAL NOT NULL,
      ai_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      position_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      side TEXT NOT NULL,
      action TEXT NOT NULL,
      price REAL NOT NULL,
      amount REAL NOT NULL,
      shares REAL NOT NULL,
      pnl REAL NOT NULL,
      created_at TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      scope TEXT NOT NULL,
      message TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function saveDb(): void {
  if (!db) return;
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  fs.writeFileSync(config.databasePath, Buffer.from(db.export()));
}

function database(): Database {
  if (!db) throw new Error("Database not initialized");
  return db;
}

export function addLog(log: Omit<AppLog, "id" | "createdAt">): AppLog {
  const item: AppLog = { id: id("log"), createdAt: nowIso(), ...log };
  database().run("INSERT INTO logs VALUES (?, ?, ?, ?, ?, ?)", [
    item.id,
    item.level,
    item.scope,
    item.message,
    JSON.stringify(item.details ?? null),
    item.createdAt
  ]);
  saveDb();
  return item;
}

export function listLogs(limit = 120): AppLog[] {
  const rows = database().exec("SELECT * FROM logs ORDER BY created_at DESC LIMIT ?", [limit])[0]?.values ?? [];
  return rows.map((row) => ({
    id: String(row[0]),
    level: row[1] as AppLog["level"],
    scope: row[2] as AppLog["scope"],
    message: String(row[3]),
    details: safeJsonParse(String(row[4]), null),
    createdAt: String(row[5])
  }));
}

export function upsertCandidate(candidate: Candidate): void {
  database().run("INSERT OR REPLACE INTO candidates VALUES (?, ?, ?, ?, ?, ?, ?)", [
    candidate.id,
    JSON.stringify(candidate.option),
    JSON.stringify(candidate.weather),
    JSON.stringify(candidate.aiDecision),
    candidate.riskMode,
    candidate.createdAt,
    candidate.expiresAt
  ]);
  saveDb();
}

export function listCandidates(): Candidate[] {
  deleteExpiredCandidates();
  const rows = database().exec("SELECT * FROM candidates ORDER BY created_at DESC")[0]?.values ?? [];
  return rows.map((row) => ({
    id: String(row[0]),
    option: safeJsonParse(String(row[1]), {} as Candidate["option"]),
    weather: safeJsonParse(String(row[2]), {} as Candidate["weather"]),
    aiDecision: safeJsonParse(String(row[3]), {} as Candidate["aiDecision"]),
    riskMode: row[4] as Candidate["riskMode"],
    createdAt: String(row[5]),
    expiresAt: String(row[6])
  }));
}

export function deleteCandidate(candidateId: string): boolean {
  database().run("DELETE FROM candidates WHERE id = ?", [candidateId]);
  saveDb();
  return true;
}

export function deleteExpiredCandidates(): void {
  database().run("DELETE FROM candidates WHERE expires_at <= ?", [nowIso()]);
  saveDb();
}

export function insertPosition(position: Position): void {
  database().run("INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    position.id,
    position.candidateId,
    position.marketId,
    position.tokenId,
    position.side,
    position.question,
    position.location,
    position.targetDate,
    position.entryPrice,
    position.currentPrice,
    position.amount,
    position.shares,
    position.status,
    position.openedAt,
    position.closedAt,
    position.realizedPnl,
    position.unrealizedPnl,
    JSON.stringify(position.aiDecision)
  ]);
  saveDb();
}

export function updatePosition(position: Position): void {
  database().run(
    `UPDATE positions SET current_price=?, status=?, closed_at=?, realized_pnl=?, unrealized_pnl=?, ai_json=? WHERE id=?`,
    [
      position.currentPrice,
      position.status,
      position.closedAt,
      position.realizedPnl,
      position.unrealizedPnl,
      JSON.stringify(position.aiDecision),
      position.id
    ]
  );
  saveDb();
}

export function listPositions(): Position[] {
  const rows = database().exec("SELECT * FROM positions ORDER BY opened_at DESC")[0]?.values ?? [];
  return rows.map(positionFromRow);
}

function positionFromRow(row: unknown[]): Position {
  return {
    id: String(row[0]),
    candidateId: String(row[1]),
    marketId: String(row[2]),
    tokenId: String(row[3]),
    side: row[4] as Position["side"],
    question: String(row[5]),
    location: String(row[6]),
    targetDate: String(row[7]),
    entryPrice: Number(row[8]),
    currentPrice: Number(row[9]),
    amount: Number(row[10]),
    shares: Number(row[11]),
    status: row[12] as Position["status"],
    openedAt: String(row[13]),
    closedAt: row[14] ? String(row[14]) : null,
    realizedPnl: Number(row[15]),
    unrealizedPnl: Number(row[16]),
    aiDecision: safeJsonParse(String(row[17]), {} as Position["aiDecision"])
  };
}

export function insertTrade(trade: Trade): void {
  database().run("INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
    trade.id,
    trade.positionId,
    trade.marketId,
    trade.side,
    trade.action,
    trade.price,
    trade.amount,
    trade.shares,
    trade.pnl,
    trade.createdAt,
    trade.reason
  ]);
  saveDb();
}

export function listTrades(): Trade[] {
  const rows = database().exec("SELECT * FROM trades ORDER BY created_at DESC")[0]?.values ?? [];
  return rows.map((row) => ({
    id: String(row[0]),
    positionId: String(row[1]),
    marketId: String(row[2]),
    side: row[3] as Trade["side"],
    action: row[4] as Trade["action"],
    price: Number(row[5]),
    amount: Number(row[6]),
    shares: Number(row[7]),
    pnl: Number(row[8]),
    createdAt: String(row[9]),
    reason: String(row[10])
  }));
}

export function getPortfolio(initialCapital: number): Portfolio {
  const positions = listPositions();
  const trades = listTrades();
  const spentOpen = positions.filter((p) => p.status === "open").reduce((sum, p) => sum + p.amount, 0);
  const realizedPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);
  const unrealizedPnl = positions.filter((p) => p.status === "open").reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const cash = initialCapital - spentOpen + realizedPnl;
  return {
    cash,
    initialCapital,
    openPositions: positions.filter((p) => p.status === "open"),
    closedPositions: positions.filter((p) => p.status === "closed"),
    trades,
    realizedPnl,
    unrealizedPnl,
    equity: cash + spentOpen + unrealizedPnl
  };
}
