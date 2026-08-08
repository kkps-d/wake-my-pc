export interface PcRecord {
  id: string;
  name: string;
  ipAddress: string;
  macAddress: string;
  createdAt: string;
}

export interface PcInput {
  name?: string;
  ipAddress: string;
  macAddress: string;
}

export type Reachability =
  | "checking"
  | "reachable"
  | "unreachable"
  | "waking"
  | "error";

export interface StatusSnapshot {
  state: Reachability;
  message?: string;
  checkedAt?: string;
}

export interface PcRepository {
  initialize(): Promise<void>;
  list(): Promise<PcRecord[]>;
  get(id: string): Promise<PcRecord | undefined>;
  add(input: PcInput): Promise<PcRecord>;
  remove(id: string): Promise<boolean>;
}

export interface PingService {
  isReachable(ipAddress: string): Promise<boolean>;
}

export interface ArpService {
  resolve(ipAddress: string): Promise<string | undefined>;
}

export interface WolService {
  wake(pc: Pick<PcRecord, "ipAddress" | "macAddress">): Promise<void>;
}

export interface WakeCoordinator {
  getStatus(pc: PcRecord, refresh?: boolean): Promise<StatusSnapshot>;
  start(pc: PcRecord): Promise<StatusSnapshot>;
  cancel(pcId: string): void;
  stop(): void;
}
