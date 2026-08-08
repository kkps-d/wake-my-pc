import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  dataFile: string;
  wolBroadcastAddress?: string;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    dataFile: path.resolve(cwd, env.DATA_FILE?.trim() || "data/pcs.json"),
    wolBroadcastAddress: env.WOL_BROADCAST_ADDRESS?.trim() || undefined,
  };
}
