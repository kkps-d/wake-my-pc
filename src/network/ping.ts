import ping from "ping";

import type { PingService } from "../contracts.js";
import { isIpv4 } from "./address.js";

export interface PingProbeResult {
  alive: boolean;
}

export type PingProbe = (
  address: string,
  config: { timeout: number },
) => Promise<PingProbeResult>;

const defaultProbe: PingProbe = (address, config) =>
  ping.promise.probe(address, config);

/** A small, platform-independent wrapper around the `ping` package. */
export class CrossPlatformPingService implements PingService {
  public constructor(
    private readonly probe: PingProbe = defaultProbe,
    private readonly timeoutSeconds = 1,
  ) {}

  public async isReachable(ipAddress: string): Promise<boolean> {
    if (!isIpv4(ipAddress)) {
      return false;
    }

    try {
      return (await this.probe(ipAddress, { timeout: this.timeoutSeconds })).alive;
    } catch {
      // A missing ping executable or a network error means the host is not
      // currently reachable from this application's perspective.
      return false;
    }
  }
}
