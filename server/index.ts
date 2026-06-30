import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { addLog, deleteCandidate, initDb, listCandidates, listLogs } from "./db.js";
import { runScan, setScanSchedule } from "./scanner.js";
import { portfolio, reviewPositions, runBuyCycle } from "./trading.js";

const settingsSchema = z.object({
  scanIntervalMinutes: z.coerce.number().min(1).max(1440).default(30),
  maxCandidates: z.coerce.number().min(1).max(25).default(5),
  candidateTtlHours: z.coerce.number().min(1).max(720).default(24),
  initialCapital: z.coerce.number().min(1).default(1000),
  orderAmount: z.coerce.number().min(1).default(10),
  maxBuysPerMarket: z.coerce.number().min(1).max(10).default(1),
  riskMode: z.enum(["conservative", "balanced", "aggressive"]).default("balanced"),
  userPrompt: z.string().default("")
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    aiModel: config.aiModel,
    aiConfigured: Boolean(config.aiApiKey),
    noaaConfigured: Boolean(config.noaaToken)
  });
});

app.post("/api/scan/run", async (req, res, next) => {
  try {
    const settings = settingsSchema.parse(req.body);
    res.json(await runScan(settings));
  } catch (error) {
    next(error);
  }
});

app.post("/api/scan/schedule", (req, res, next) => {
  try {
    const settings = settingsSchema.parse(req.body.settings ?? req.body);
    const enabled = Boolean(req.body.enabled);
    res.json(setScanSchedule(settings, enabled));
  } catch (error) {
    next(error);
  }
});

app.get("/api/candidates", (_req, res) => {
  res.json(listCandidates());
});

app.delete("/api/candidates/:id", (req, res) => {
  deleteCandidate(req.params.id);
  addLog({ level: "info", scope: "candidate", message: "已删除候选项。", details: { id: req.params.id } });
  res.json({ ok: true });
});

app.post("/api/trading/run", async (req, res, next) => {
  try {
    const settings = settingsSchema.parse(req.body);
    res.json(await runBuyCycle(settings));
  } catch (error) {
    next(error);
  }
});

app.post("/api/positions/review", async (req, res, next) => {
  try {
    const settings = settingsSchema.parse(req.body);
    res.json(await reviewPositions(settings));
  } catch (error) {
    next(error);
  }
});

app.get("/api/portfolio", (req, res) => {
  const initialCapital = Number(req.query.initialCapital ?? 1000);
  res.json(portfolio({ initialCapital }));
});

app.get("/api/logs", (req, res) => {
  res.json(listLogs(Number(req.query.limit ?? 120)));
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  addLog({ level: "error", scope: "system", message, details: error });
  res.status(500).json({ error: message });
});

await initDb();
app.listen(config.port, () => {
  addLog({ level: "success", scope: "system", message: `后端已启动：http://localhost:${config.port}`, details: { aiModel: config.aiModel } });
  console.log(`API server listening on http://localhost:${config.port}`);
});
