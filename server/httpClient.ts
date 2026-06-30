import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function getJson<T>(url: string): Promise<T> {
  if (shouldUsePowerShell(url)) return getJsonViaPowerShell<T>(url, undefined);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    return getJsonViaPowerShell<T>(url, error);
  }
}

export async function getText(url: string): Promise<string> {
  if (shouldUsePowerShell(url)) return getTextViaPowerShell(url, undefined);
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch (error) {
    return getTextViaPowerShell(url, error);
  }
}

function shouldUsePowerShell(url: string): boolean {
  return process.platform === "win32" && /\/\/(?:gamma-api|clob)\.polymarket\.com|\/\/polymarket\.com/.test(url);
}

async function getJsonViaPowerShell<T>(url: string, cause: unknown): Promise<T> {
  if (process.platform !== "win32") throw cause;
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$url = $args[0]",
    "$response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 30",
    "ConvertTo-Json -InputObject $response -Depth 30 -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& { ${script} }`, url], {
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(stdout) as T;
}

async function getTextViaPowerShell(url: string, cause: unknown): Promise<string> {
  if (process.platform !== "win32") throw cause;
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$url = $args[0]",
    "(Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30).Content"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& { ${script} }`, url], {
    maxBuffer: 20 * 1024 * 1024
  });
  return stdout;
}
