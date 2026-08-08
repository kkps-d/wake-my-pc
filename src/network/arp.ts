import { execFile as execFileCallback } from "node:child_process";

import type { ArpService, PingService } from "../contracts.js";
import { isIpv4, normalizeMacAddress } from "./address.js";

export interface ExecFileOptions {
  timeout: number;
  maxBuffer: number;
  windowsHide: boolean;
}

export type ExecFileRunner = (
  file: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

const commandOptions: ExecFileOptions = {
  timeout: 1_500,
  maxBuffer: 64 * 1024,
  windowsHide: true,
};

const defaultExecFile: ExecFileRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFileCallback(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

function firstMac(value: string): string | undefined {
  const match = value.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
  return match ? normalizeMacAddress(match[0]) : undefined;
}

/** Parses `ip neigh show ADDRESS` output. */
export function parseLinuxIpNeigh(output: string, ipAddress: string): string | undefined {
  const escaped = ipAddress.replace(/\./g, "\\.");
  const line = output
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^${escaped}(?:\\s|$)`).test(candidate));
  return line ? firstMac(line) : undefined;
}

/** Parses BSD/macOS and Linux `arp -n ADDRESS` output. */
export function parseArpN(output: string, ipAddress: string): string | undefined {
  const escaped = ipAddress.replace(/\./g, "\\.");
  const line = output
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`(?:^|\\(|\\s)${escaped}(?:\\)|\\s|$)`).test(candidate));
  return line ? firstMac(line) : undefined;
}

/** Parses Windows `arp -a ADDRESS` output. */
export function parseWindowsArpA(output: string, ipAddress: string): string | undefined {
  const escaped = ipAddress.replace(/\./g, "\\.");
  const line = output
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^\\s*${escaped}\\s+`, "i").test(candidate));
  return line ? firstMac(line) : undefined;
}

export interface CrossPlatformArpOptions {
  ping: PingService;
  platform?: NodeJS.Platform;
  execFile?: ExecFileRunner;
}

/**
 * Resolves a MAC from the OS neighbour cache. Resolution is intentionally
 * best-effort: a sleeping host has no ARP entry, so callers receive undefined.
 */
export class CrossPlatformArpService implements ArpService {
  private readonly platform: NodeJS.Platform;
  private readonly execFile: ExecFileRunner;

  private readonly ping: PingService;

  public constructor(options: CrossPlatformArpOptions | PingService) {
    const resolved = "ping" in options ? options : { ping: options };
    this.ping = resolved.ping;
    this.platform = resolved.platform ?? process.platform;
    this.execFile = resolved.execFile ?? defaultExecFile;
  }

  public async resolve(ipAddress: string): Promise<string | undefined> {
    if (!isIpv4(ipAddress)) {
      return undefined;
    }

    // Populate a stale/empty neighbour table where possible. Failure is normal
    // for sleeping PCs and must not prevent inspecting a pre-existing entry.
    await this.ping.isReachable(ipAddress).catch(() => false);

    if (this.platform === "linux") {
      const neighbour = await this.run("ip", ["neigh", "show", ipAddress]);
      const mac = neighbour && parseLinuxIpNeigh(neighbour, ipAddress);
      return mac ?? this.readArpN(ipAddress);
    }

    if (this.platform === "darwin") {
      return this.readArpN(ipAddress);
    }

    if (this.platform === "win32") {
      const output = await this.run("arp", ["-a", ipAddress]);
      return output ? parseWindowsArpA(output, ipAddress) : undefined;
    }

    return undefined;
  }

  private async readArpN(ipAddress: string): Promise<string | undefined> {
    const output = await this.run("arp", ["-n", ipAddress]);
    return output ? parseArpN(output, ipAddress) : undefined;
  }

  private async run(file: string, args: string[]): Promise<string | undefined> {
    try {
      return (await this.execFile(file, args, commandOptions)).stdout;
    } catch {
      return undefined;
    }
  }
}
