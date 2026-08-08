import dgram from "node:dgram";
import { networkInterfaces as systemNetworkInterfaces } from "node:os";

import type { WolService } from "../contracts.js";
import {
  ipv4ToNumber,
  isIpv4,
  normalizeMacAddress,
  numberToIpv4,
} from "./address.js";

type NetworkInterfaces = ReturnType<typeof systemNetworkInterfaces>;

export interface BroadcastCandidate {
  address: string;
  netmask: string;
  internal: boolean;
  family: string;
}

/** Calculates the directed broadcast address for a target in an interface subnet. */
export function calculateBroadcastAddress(
  targetIp: string,
  interfaces: NetworkInterfaces = systemNetworkInterfaces(),
): string | undefined {
  const target = ipv4ToNumber(targetIp);
  if (target === undefined) {
    return undefined;
  }

  for (const addresses of Object.values(interfaces)) {
    for (const candidate of addresses ?? []) {
      if (
        candidate.internal ||
        candidate.family !== "IPv4" ||
        !isIpv4(candidate.address) ||
        !isIpv4(candidate.netmask)
      ) {
        continue;
      }

      const address = ipv4ToNumber(candidate.address);
      const netmask = ipv4ToNumber(candidate.netmask);
      if (address === undefined || netmask === undefined) {
        continue;
      }

      if ((target & netmask) === (address & netmask)) {
        return numberToIpv4(((address & netmask) | (~netmask >>> 0)) >>> 0);
      }
    }
  }

  return undefined;
}

/** Builds the 102-byte Wake-on-LAN magic packet for a MAC address. */
export function buildMagicPacket(macAddress: string): Buffer {
  const normalized = normalizeMacAddress(macAddress);
  if (!normalized) {
    throw new Error("A valid MAC address is required to send Wake-on-LAN.");
  }

  const mac = Buffer.from(normalized.replaceAll(":", ""), "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => mac)]);
}

export interface UdpSocket {
  bind(port: number, callback: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
  setBroadcast(flag: boolean): void;
  send(
    message: Buffer,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ): void;
  close(callback?: () => void): void;
}

export interface NodeDgramWolOptions {
  broadcastAddress?: string;
  networkInterfaces?: () => NetworkInterfaces;
  createSocket?: () => UdpSocket;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultWait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const defaultCreateSocket = (): UdpSocket => dgram.createSocket("udp4");

/** Sends three UDP broadcast magic packets, spaced 100ms apart. */
export class NodeDgramWolService implements WolService {
  private readonly networkInterfaces: () => NetworkInterfaces;
  private readonly createSocket: () => UdpSocket;
  private readonly wait: (milliseconds: number) => Promise<void>;

  public constructor(private readonly options: NodeDgramWolOptions = {}) {
    if (options.broadcastAddress && !isIpv4(options.broadcastAddress)) {
      throw new Error("WOL_BROADCAST_ADDRESS must be a valid IPv4 address.");
    }
    this.networkInterfaces = options.networkInterfaces ?? systemNetworkInterfaces;
    this.createSocket = options.createSocket ?? defaultCreateSocket;
    this.wait = options.wait ?? defaultWait;
  }

  public async wake(pc: { ipAddress: string; macAddress: string }): Promise<void> {
    if (!isIpv4(pc.ipAddress)) {
      throw new Error("A valid IPv4 address is required to send Wake-on-LAN.");
    }

    const broadcastAddress =
      this.options.broadcastAddress ??
      calculateBroadcastAddress(pc.ipAddress, this.networkInterfaces());
    if (!broadcastAddress) {
      throw new Error(
        "Unable to determine a broadcast address for this PC. Set WOL_BROADCAST_ADDRESS.",
      );
    }

    const packet = buildMagicPacket(pc.macAddress);
    const socket = this.createSocket();
    try {
      await this.withSocketErrors(socket, async () => {
        await this.bind(socket);
        socket.setBroadcast(true);
        for (let index = 0; index < 3; index += 1) {
          await this.send(socket, packet, broadcastAddress);
          if (index < 2) {
            await this.wait(100);
          }
        }
      });
    } finally {
      try {
        socket.close();
      } catch {
        // A socket that failed before binding may already be closed.
      }
    }
  }

  private bind(socket: UdpSocket): Promise<void> {
    return new Promise((resolve) => socket.bind(0, resolve));
  }

  private withSocketErrors(socket: UdpSocket, operation: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.off("error", handleError);
        if (error) reject(error);
        else resolve();
      };
      const handleError = (error: Error): void => finish(error);
      socket.once("error", handleError);
      void operation().then(() => finish(), (error: unknown) => {
        finish(error instanceof Error ? error : new Error("UDP broadcast failed."));
      });
    });
  }

  private send(socket: UdpSocket, packet: Buffer, address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.send(packet, 9, address, (error) => (error ? reject(error) : resolve()));
    });
  }
}
