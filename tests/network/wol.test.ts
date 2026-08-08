import { describe, expect, it, vi } from "vitest";

import { isIpv4, normalizeMacAddress } from "../../src/network/address.js";
import { buildMagicPacket, calculateBroadcastAddress, NodeDgramWolService } from "../../src/network/wol.js";

describe("network address helpers", () => {
  it("strictly validates IPv4 addresses and normalizes MAC forms", () => {
    expect(isIpv4("192.168.1.1")).toBe(true);
    expect(isIpv4("999.168.1.1")).toBe(false);
    expect(isIpv4("1.2.3")).toBe(false);
    expect(normalizeMacAddress("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMacAddress("not a mac")).toBeUndefined();
  });

  it("builds the canonical 102-byte magic packet", () => {
    const packet = buildMagicPacket("00:11:22:33:44:55");
    expect(packet).toHaveLength(102);
    expect([...packet.subarray(0, 6)]).toEqual([255, 255, 255, 255, 255, 255]);
    expect(packet.subarray(6, 12).toString("hex")).toBe("001122334455");
    expect(packet.subarray(96).toString("hex")).toBe("001122334455");
  });

  it("finds a target's matching non-internal interface broadcast address", () => {
    const interfaces = {
      lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
      lan: [{ address: "192.168.50.10", netmask: "255.255.255.0", family: "IPv4", internal: false }],
    } as ReturnType<typeof import("node:os").networkInterfaces>;
    expect(calculateBroadcastAddress("192.168.50.200", interfaces)).toBe("192.168.50.255");
    expect(calculateBroadcastAddress("10.0.0.2", interfaces)).toBeUndefined();
  });
});

describe("NodeDgramWolService", () => {
  it("broadcasts three packets and always closes the socket", async () => {
    const socket = {
      bind: vi.fn((_port, callback) => callback()),
      once: vi.fn(),
      off: vi.fn(),
      setBroadcast: vi.fn(),
      send: vi.fn((_packet, _port, _address, callback) => callback(null)),
      close: vi.fn(),
    };
    const wait = vi.fn().mockResolvedValue(undefined);
    const service = new NodeDgramWolService({
      broadcastAddress: "192.168.1.255",
      createSocket: () => socket,
      wait,
    });

    await service.wake({ ipAddress: "192.168.1.30", macAddress: "aa:bb:cc:dd:ee:ff" });
    expect(socket.setBroadcast).toHaveBeenCalledWith(true);
    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(socket.send.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      [9, "192.168.1.255"],
      [9, "192.168.1.255"],
      [9, "192.168.1.255"],
    ]);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(100);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("closes after a UDP error and reports absent broadcast configuration", async () => {
    const socket = {
      bind: vi.fn((_port, callback) => callback()),
      once: vi.fn(),
      off: vi.fn(),
      setBroadcast: vi.fn(),
      send: vi.fn((_packet, _port, _address, callback) => callback(new Error("UDP unavailable"))),
      close: vi.fn(),
    };
    const service = new NodeDgramWolService({ createSocket: () => socket, networkInterfaces: () => ({}) });
    await expect(service.wake({ ipAddress: "10.0.0.3", macAddress: "00:11:22:33:44:55" })).rejects.toThrow(
      "Unable to determine a broadcast address",
    );
    expect(socket.close).not.toHaveBeenCalled();

    const sending = new NodeDgramWolService({
      broadcastAddress: "10.0.0.255",
      createSocket: () => socket,
    });
    await expect(sending.wake({ ipAddress: "10.0.0.3", macAddress: "00:11:22:33:44:55" })).rejects.toThrow(
      "UDP unavailable",
    );
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("handles socket error events for the entire broadcast lifecycle", async () => {
    let socketError!: (error: Error) => void;
    const socket = {
      bind: vi.fn((_port, callback) => callback()),
      once: vi.fn((_event, listener) => {
        socketError = listener;
      }),
      off: vi.fn(),
      setBroadcast: vi.fn(),
      send: vi.fn((_packet, _port, _address, callback) => callback(null)),
      close: vi.fn(),
    };
    const service = new NodeDgramWolService({
      broadcastAddress: "192.168.1.255",
      createSocket: () => socket,
      wait: vi.fn(() => {
        socketError(new Error("socket failed"));
        return new Promise<void>(() => undefined);
      }),
    });

    await expect(
      service.wake({ ipAddress: "192.168.1.30", macAddress: "AA:BB:CC:DD:EE:FF" }),
    ).rejects.toThrow("socket failed");
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.off).toHaveBeenCalledWith("error", socketError);
  });
});
