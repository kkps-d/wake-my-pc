import { describe, expect, it, vi } from "vitest";

import {
  CrossPlatformArpService,
  parseArpN,
  parseLinuxIpNeigh,
  parseWindowsArpA,
} from "../../src/network/arp.js";

describe("ARP parsers", () => {
  it("parses Linux ip neighbour entries", () => {
    expect(
      parseLinuxIpNeigh(
        "192.168.1.40 dev en0 lladdr a1-b2-c3-d4-e5-f6 REACHABLE",
        "192.168.1.40",
      ),
    ).toBe("A1:B2:C3:D4:E5:F6");
  });

  it("parses macOS/BSD arp output", () => {
    expect(parseArpN("? (10.0.0.4) at 00:11:22:33:44:55 on en0", "10.0.0.4")).toBe(
      "00:11:22:33:44:55",
    );
  });

  it("parses Windows arp output", () => {
    expect(
      parseWindowsArpA(
        "  Internet Address      Physical Address      Type\n  172.16.0.8           aa-bb-cc-dd-ee-ff     dynamic",
        "172.16.0.8",
      ),
    ).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("does not return a MAC belonging to another address", () => {
    expect(parseWindowsArpA("  10.0.0.3  aa-bb-cc-dd-ee-ff dynamic", "10.0.0.4")).toBeUndefined();
  });
});

describe("CrossPlatformArpService", () => {
  it("primes ARP then falls back to arp -n when ip neigh has no MAC", async () => {
    const ping = { isReachable: vi.fn().mockResolvedValue(false) };
    const execFile = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "10.0.0.8 dev en0 FAILED", stderr: "" })
      .mockResolvedValueOnce({ stdout: "? (10.0.0.8) at 01:23:45:67:89:ab", stderr: "" });
    const service = new CrossPlatformArpService({ ping, platform: "linux", execFile });

    await expect(service.resolve("10.0.0.8")).resolves.toBe("01:23:45:67:89:AB");
    expect(ping.isReachable).toHaveBeenCalledWith("10.0.0.8");
    expect(execFile.mock.calls.map(([file]) => file)).toEqual(["ip", "arp"]);
    expect(execFile.mock.calls[0]?.[1]).toEqual(["neigh", "show", "10.0.0.8"]);
    expect(execFile.mock.calls[1]?.[1]).toEqual(["-n", "10.0.0.8"]);
  });

  it("uses shell-free platform commands and treats failures as unavailable", async () => {
    const execFile = vi.fn().mockRejectedValue(new Error("missing"));
    const service = new CrossPlatformArpService(
      { isReachable: vi.fn().mockRejectedValue(new Error("no ping")) },
    );
    const windows = new CrossPlatformArpService({
      ping: { isReachable: vi.fn().mockResolvedValue(false) },
      platform: "win32",
      execFile,
    });
    await expect(service.resolve("bad value")).resolves.toBeUndefined();
    await expect(windows.resolve("192.168.0.2")).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledWith(
      "arp",
      ["-a", "192.168.0.2"],
      expect.objectContaining({ timeout: 1500, maxBuffer: 64 * 1024 }),
    );
  });
});
