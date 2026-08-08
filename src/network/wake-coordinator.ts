import type {
  PcRecord,
  PingService,
  StatusSnapshot,
  WakeCoordinator,
  WolService,
} from "../contracts.js";

interface ActiveWakeJob {
  readonly pc: PcRecord;
  readonly deadlineAt: number;
  nextPollAt: number;
  pollTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

interface CachedStatus {
  readonly snapshot: StatusSnapshot;
  readonly expiresAt: number;
}

export interface TimerApi {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface InMemoryWakeCoordinatorOptions {
  now?: () => number;
  timers?: TimerApi;
  statusCacheMs?: number;
  wakePollMs?: number;
  wakeTimeoutMs?: number;
}

const defaultTimers: TimerApi = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** Coordinates transient ping state and Wake-on-LAN retry checks in memory. */
export class InMemoryWakeCoordinator implements WakeCoordinator {
  private readonly jobs = new Map<string, ActiveWakeJob>();
  private readonly statuses = new Map<string, CachedStatus>();
  private readonly inFlightChecks = new Map<string, Promise<StatusSnapshot>>();
  private readonly generations = new Map<string, number>();
  private readonly now: () => number;
  private readonly timers: TimerApi;
  private readonly statusCacheMs: number;
  private readonly wakePollMs: number;
  private readonly wakeTimeoutMs: number;

  public constructor(
    private readonly ping: PingService,
    private readonly wol: WolService,
    options: InMemoryWakeCoordinatorOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? defaultTimers;
    this.statusCacheMs = options.statusCacheMs ?? 30_000;
    this.wakePollMs = options.wakePollMs ?? 2_000;
    this.wakeTimeoutMs = options.wakeTimeoutMs ?? 60_000;
  }

  public async getStatus(pc: PcRecord, refresh = false): Promise<StatusSnapshot> {
    if (this.jobs.has(pc.id)) {
      return this.wakingSnapshot();
    }

    const cached = this.statuses.get(pc.id);
    if (!refresh && cached && cached.expiresAt > this.now()) {
      return cached.snapshot;
    }

    const existing = this.inFlightChecks.get(pc.id);
    if (existing) {
      return existing;
    }

    const generation = this.generation(pc.id);
    const check = this.checkStatus(pc, generation);
    this.inFlightChecks.set(pc.id, check);
    try {
      return await check;
    } finally {
      if (this.inFlightChecks.get(pc.id) === check) {
        this.inFlightChecks.delete(pc.id);
      }
      this.pruneGeneration(pc.id);
    }
  }

  public async start(pc: PcRecord): Promise<StatusSnapshot> {
    if (this.jobs.has(pc.id)) {
      return this.wakingSnapshot();
    }

    this.invalidate(pc.id);
    const startedAt = this.now();
    const job: ActiveWakeJob = {
      pc,
      deadlineAt: startedAt + this.wakeTimeoutMs,
      nextPollAt: startedAt + this.wakePollMs,
    };
    this.jobs.set(pc.id, job);
    this.setStatus(pc.id, this.wakingSnapshot());
    job.timeoutTimer = this.timers.setTimeout(() => {
      if (this.jobs.get(pc.id) === job) {
        this.finish(job, { state: "unreachable" });
      }
    }, this.wakeTimeoutMs);
    void this.runWakeJob(job);
    return this.wakingSnapshot();
  }

  public cancel(pcId: string): void {
    const hadInFlightCheck = this.inFlightChecks.has(pcId);
    const job = this.jobs.get(pcId);
    this.clearJobTimers(job);
    this.jobs.delete(pcId);
    this.statuses.delete(pcId);
    this.inFlightChecks.delete(pcId);
    this.invalidate(pcId);
    if (!hadInFlightCheck) {
      this.generations.delete(pcId);
    }
  }

  public stop(): void {
    const pcIds = new Set([
      ...this.jobs.keys(),
      ...this.statuses.keys(),
      ...this.inFlightChecks.keys(),
    ]);
    for (const pcId of pcIds) {
      this.cancel(pcId);
    }
    this.statuses.clear();
    this.inFlightChecks.clear();
  }

  private async runWakeJob(job: ActiveWakeJob): Promise<void> {
    try {
      await this.wol.wake(job.pc);
      await this.attemptWakePing(job);
    } catch (error) {
      if (this.jobs.get(job.pc.id) === job) {
        this.finish(job, {
          state: "error",
          message: error instanceof Error ? error.message : "Wake request failed.",
        });
      }
    }
  }

  private async attemptWakePing(job: ActiveWakeJob): Promise<void> {
    if (this.jobs.get(job.pc.id) !== job) {
      return;
    }

    let reachable = false;
    try {
      reachable = await this.ping.isReachable(job.pc.ipAddress);
    } catch {
      reachable = false;
    }
    if (this.jobs.get(job.pc.id) !== job) {
      return;
    }

    if (reachable) {
      this.finish(job, { state: "reachable" });
      return;
    }

    if (this.now() >= job.deadlineAt) {
      this.finish(job, { state: "unreachable" });
      return;
    }

    while (job.nextPollAt <= this.now()) {
      job.nextPollAt += this.wakePollMs;
    }
    const delay = Math.max(0, Math.min(job.nextPollAt, job.deadlineAt) - this.now());
    job.nextPollAt += this.wakePollMs;
    job.pollTimer = this.timers.setTimeout(() => {
      void this.attemptWakePing(job);
    }, delay);
  }

  private async checkStatus(pc: PcRecord, generation: number): Promise<StatusSnapshot> {
    let reachable = false;
    try {
      reachable = await this.ping.isReachable(pc.ipAddress);
    } catch {
      reachable = false;
    }
    const snapshot: StatusSnapshot = { state: reachable ? "reachable" : "unreachable" };
    if (this.generation(pc.id) !== generation || this.jobs.has(pc.id)) {
      return this.currentSnapshot(pc.id);
    }
    this.setStatus(pc.id, snapshot);
    return snapshot;
  }

  private finish(job: ActiveWakeJob, snapshot: StatusSnapshot): void {
    this.clearJobTimers(job);
    this.jobs.delete(job.pc.id);
    this.setStatus(job.pc.id, snapshot);
  }

  private clearJobTimers(job: ActiveWakeJob | undefined): void {
    if (job?.pollTimer) {
      this.timers.clearTimeout(job.pollTimer);
    }
    if (job?.timeoutTimer) {
      this.timers.clearTimeout(job.timeoutTimer);
    }
  }

  private currentSnapshot(pcId: string): StatusSnapshot {
    if (this.jobs.has(pcId)) {
      return this.wakingSnapshot();
    }
    return this.statuses.get(pcId)?.snapshot ?? { state: "checking" };
  }

  private generation(pcId: string): number {
    return this.generations.get(pcId) ?? 0;
  }

  private invalidate(pcId: string): void {
    this.generations.set(pcId, this.generation(pcId) + 1);
  }

  private pruneGeneration(pcId: string): void {
    if (
      !this.jobs.has(pcId) &&
      !this.statuses.has(pcId) &&
      !this.inFlightChecks.has(pcId)
    ) {
      this.generations.delete(pcId);
    }
  }

  private wakingSnapshot(): StatusSnapshot {
    return { state: "waking", message: "Wake request sent; checking reachability." };
  }

  private setStatus(pcId: string, snapshot: StatusSnapshot): void {
    const stamped: StatusSnapshot = { ...snapshot, checkedAt: new Date(this.now()).toISOString() };
    this.statuses.set(pcId, { snapshot: stamped, expiresAt: this.now() + this.statusCacheMs });
  }
}
