import { describe, expect, it, vi } from "vitest";

import type { PcRecord } from "../../src/contracts.js";
import { CrossPlatformPingService } from "../../src/network/ping.js";
import { InMemoryWakeCoordinator } from "../../src/network/wake-coordinator.js";

const pc: PcRecord = {
  id: "desk",
  name: "Desk PC",
  ipAddress: "192.168.1.20",
  macAddress: "00:11:22:33:44:55",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("CrossPlatformPingService", () => {
  it("uses a short timeout and turns probe failures into unreachable", async () => {
    const probe = vi.fn().mockResolvedValue({ alive: true });
    const service = new CrossPlatformPingService(probe);
    await expect(service.isReachable("192.168.1.2")).resolves.toBe(true);
    expect(probe).toHaveBeenCalledWith("192.168.1.2", { timeout: 1 });

    probe.mockRejectedValueOnce(new Error("not installed"));
    await expect(service.isReachable("192.168.1.2")).resolves.toBe(false);
    await expect(service.isReachable("not-ip")).resolves.toBe(false);
  });
});

describe("InMemoryWakeCoordinator", () => {
  it("deduplicates concurrent normal status checks and caches their result", async () => {
    let complete!: (value: boolean) => void;
    const ping = { isReachable: vi.fn(() => new Promise<boolean>((resolve) => (complete = resolve))) };
    const coordinator = new InMemoryWakeCoordinator(ping, { wake: vi.fn() });

    const first = coordinator.getStatus(pc);
    const second = coordinator.getStatus(pc, true);
    expect(ping.isReachable).toHaveBeenCalledOnce();
    complete(true);
    await expect(first).resolves.toMatchObject({ state: "reachable" });
    await expect(second).resolves.toMatchObject({ state: "reachable" });
    await coordinator.getStatus(pc);
    expect(ping.isReachable).toHaveBeenCalledOnce();
  });

  it("sends WoL, polls immediately, and stops on the first successful ping", async () => {
    vi.useFakeTimers();
    try {
      const ping = { isReachable: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
      const wol = { wake: vi.fn().mockResolvedValue(undefined) };
      const coordinator = new InMemoryWakeCoordinator(ping, wol);

      await expect(coordinator.start(pc)).resolves.toMatchObject({ state: "waking" });
      await vi.runAllTicks();
      expect(wol.wake).toHaveBeenCalledWith(pc);
      expect(ping.isReachable).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(ping.isReachable).toHaveBeenCalledTimes(2);
      await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "reachable" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates wake requests, times out as unreachable, and cancellation stops polling", async () => {
    vi.useFakeTimers();
    try {
      const ping = { isReachable: vi.fn().mockResolvedValue(false) };
      const wol = { wake: vi.fn().mockResolvedValue(undefined) };
      const coordinator = new InMemoryWakeCoordinator(ping, wol, { wakeTimeoutMs: 4_000, wakePollMs: 2_000 });

      await coordinator.start(pc);
      await coordinator.start(pc);
      await vi.runAllTicks();
      expect(wol.wake).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "unreachable" });

      await coordinator.start(pc);
      await vi.runAllTicks();
      coordinator.cancel(pc.id);
      const countBeforeAdvance = ping.isReachable.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ping.isReachable).toHaveBeenCalledTimes(countBeforeAdvance);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records an error if the WoL sender fails and stops all work on shutdown", async () => {
    const ping = { isReachable: vi.fn().mockResolvedValue(false) };
    const coordinator = new InMemoryWakeCoordinator(ping, {
      wake: vi.fn().mockRejectedValue(new Error("broadcast blocked")),
    });
    await coordinator.start(pc);
    await vi.waitFor(async () => {
      await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "error" });
    });
    coordinator.stop();
    await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "unreachable" });
  });

  it("does not let a pre-Wake status check overwrite the Wake result", async () => {
    const completions: Array<(reachable: boolean) => void> = [];
    const ping = {
      isReachable: vi.fn(() => new Promise<boolean>((resolve) => completions.push(resolve))),
    };
    const coordinator = new InMemoryWakeCoordinator(ping, {
      wake: vi.fn().mockResolvedValue(undefined),
    });

    const staleCheck = coordinator.getStatus(pc);
    await coordinator.start(pc);
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    completions[1]?.(true);
    await vi.waitFor(async () => {
      await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "reachable" });
    });
    completions[0]?.(false);
    await expect(staleCheck).resolves.toMatchObject({ state: "reachable" });
    await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "reachable" });
  });

  it("invalidates a normal status check when the PC is cancelled", async () => {
    let complete!: (reachable: boolean) => void;
    const ping = {
      isReachable: vi
        .fn()
        .mockImplementationOnce(() => new Promise<boolean>((resolve) => (complete = resolve)))
        .mockResolvedValueOnce(true),
    };
    const coordinator = new InMemoryWakeCoordinator(ping, { wake: vi.fn() });

    const staleCheck = coordinator.getStatus(pc);
    coordinator.cancel(pc.id);
    complete(false);
    await expect(staleCheck).resolves.toMatchObject({ state: "checking" });
    await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "reachable" });
    expect(ping.isReachable).toHaveBeenCalledTimes(2);
  });

  it("uses an absolute deadline even when ping probes are slow", async () => {
    vi.useFakeTimers();
    try {
      const ping = {
        isReachable: vi.fn(
          () => new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_500)),
        ),
      };
      const coordinator = new InMemoryWakeCoordinator(
        ping,
        { wake: vi.fn().mockResolvedValue(undefined) },
        { wakePollMs: 2_000, wakeTimeoutMs: 4_000 },
      );

      await coordinator.start(pc);
      await vi.advanceTimersByTimeAsync(4_000);
      await expect(coordinator.getStatus(pc)).resolves.toMatchObject({ state: "unreachable" });
      expect(ping.isReachable).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
