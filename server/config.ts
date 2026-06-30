import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  aiBaseUrl: process.env.AI_BASE_URL ?? "https://server.max-tabs.com",
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-5.5",
  nwsUserAgent: process.env.NWS_USER_AGENT ?? "weatherbotbot/0.1 local@example.com",
  noaaToken: process.env.NOAA_CDO_TOKEN ?? "",
  databasePath: process.env.DATABASE_PATH ?? "data/weatherbot.sqlite"
};
