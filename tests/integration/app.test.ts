import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app.js";
import type { ArpService, StatusSnapshot, WakeCoordinator } from "../../src/contracts.js";
import { JsonPcRepository } from "../../src/persistence/index.js";

describe("Wake My PC HTTP application", () => {
  let temporaryDirectory: string;
  let repository: JsonPcRepository;
  let arpService: ArpService;
  let wakeCoordinator: WakeCoordinator;
  let server: Server;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), "wake-my-pc-app-"));
    repository = new JsonPcRepository(path.join(temporaryDirectory, "pcs.json"));
    await repository.initialize();
    arpService = { resolve: vi.fn().mockResolvedValue(undefined) };
    wakeCoordinator = {
      getStatus: vi.fn().mockResolvedValue({ state: "unreachable" }),
      start: vi.fn().mockResolvedValue({ state: "waking" }),
      cancel: vi.fn(),
      stop: vi.fn(),
    };
    server = createServer(application());
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function application() {
    return createApp({
      repository,
      arpService,
      wakeCoordinator,
      projectRoot: process.cwd(),
    });
  }

  it("renders the empty application and serves local browser assets", async () => {
    const page = await request(server).get("/").expect(200);
    expect(page.text).toContain("Wake My PC");
    expect(page.text).toContain("No computers saved yet");
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");

    await request(server).get("/assets/app.css").expect(200).expect("content-type", /css/);
    await request(server).get("/vendor/htmx.min.js").expect(200).expect("content-type", /javascript/);
  });

  it("renders the add form and preserves inline validation errors", async () => {
    const form = await request(server).get("/pcs/new").expect(200);
    expect(form.text).toContain("Add a PC");

    const invalid = await request(server)
      .post("/pcs")
      .type("form")
      .send({ name: "Desk", ipAddress: "not-an-ip", macAddress: "nope" })
      .expect(200);
    expect(invalid.text).toContain("Enter a valid IPv4 address");
    expect(invalid.text).toContain("Enter a MAC address");
    expect(await repository.list()).toEqual([]);
  });

  it("adds a normalized PC, defaults its name, and rejects duplicates", async () => {
    const added = await request(server)
      .post("/pcs")
      .type("form")
      .send({ name: "", ipAddress: "192.168.1.40", macAddress: "aa-bb-cc-dd-ee-ff" })
      .expect(200);

    expect(added.headers["hx-retarget"]).toBe("#pc-list");
    expect(added.headers["hx-reswap"]).toBe("outerHTML");
    expect(added.headers["hx-trigger"]).toBe("closeAddDialog");
    expect(added.text).toContain("192.168.1.40");
    expect(added.text).toContain("AA:BB:CC:DD:EE:FF");
    const [saved] = await repository.list();
    expect(saved?.name).toBe("192.168.1.40");

    const duplicate = await request(server)
      .post("/pcs")
      .type("form")
      .send({ name: "Again", ipAddress: "192.168.1.40", macAddress: "11:22:33:44:55:66" })
      .expect(200);
    expect(duplicate.text).toContain("already exists");
    expect(await repository.list()).toHaveLength(1);
  });

  it("returns ARP lookup success, validation, and not-found fragments", async () => {
    vi.mocked(arpService.resolve).mockResolvedValueOnce("AA:BB:CC:DD:EE:FF");
    const found = await request(server)
      .post("/network/resolve-mac")
      .type("form")
      .send({ ipAddress: "192.168.1.25", macAddress: "" })
      .expect(200);
    expect(found.text).toContain("AA:BB:CC:DD:EE:FF");
    expect(found.text).toContain("MAC address found");

    const invalid = await request(server)
      .post("/network/resolve-mac")
      .type("form")
      .send({ ipAddress: "invalid", macAddress: "" })
      .expect(200);
    expect(invalid.text).toContain("valid IPv4 address");

    const missing = await request(server)
      .post("/network/resolve-mac")
      .type("form")
      .send({ ipAddress: "192.168.1.26", macAddress: "" })
      .expect(200);
    expect(missing.text).toContain("No MAC address was found");
  });

  it("renders live status, starts Wake, and removes a PC", async () => {
    const pc = await repository.add({
      name: "Office",
      ipAddress: "192.168.1.80",
      macAddress: "00:11:22:33:44:55",
    });
    const reachable: StatusSnapshot = { state: "reachable" };
    vi.mocked(wakeCoordinator.getStatus).mockResolvedValueOnce(reachable);

    const status = await request(server).get(`/pcs/${pc.id}/status`).expect(200);
    expect(status.text).toContain("Reachable");
    expect(status.text).toContain('hx-trigger="every 30s"');
    expect(status.text).not.toContain("load delay:100ms");
    expect(wakeCoordinator.getStatus).toHaveBeenCalledWith(pc);

    const waking = await request(server).post(`/pcs/${pc.id}/wake`).expect(200);
    expect(waking.text).toContain("Waking");
    expect(waking.text).toContain('hx-trigger="every 2s"');
    expect(waking.text).not.toContain("load delay:100ms");
    expect(wakeCoordinator.start).toHaveBeenCalledWith(pc);

    const confirmation = await request(server)
      .get(`/pcs/${pc.id}/delete-confirm`)
      .expect(200);
    expect(confirmation.text).toContain("Remove Office?");

    const removed = await request(server).delete(`/pcs/${pc.id}`).expect(200);
    expect(removed.headers["hx-trigger"]).toBe("closeDeleteDialog");
    expect(wakeCoordinator.cancel).toHaveBeenCalledWith(pc.id);
    expect(await repository.get(pc.id)).toBeUndefined();
  });

  it("rejects browser cross-site mutations", async () => {
    await request(server)
      .post("/pcs")
      .set("Host", "wake.local:3000")
      .set("Origin", "https://evil.example")
      .type("form")
      .send({ ipAddress: "192.168.1.2", macAddress: "00:11:22:33:44:55" })
      .expect(403);
    expect(await repository.list()).toEqual([]);
  });

  it("serializes Wake and deletion so no wake job survives removal", async () => {
    const pc = await repository.add({
      name: "Race PC",
      ipAddress: "192.168.1.90",
      macAddress: "00:AA:BB:CC:DD:EE",
    });
    let finishStart!: (status: StatusSnapshot) => void;
    vi.mocked(wakeCoordinator.start).mockImplementationOnce(
      () => new Promise<StatusSnapshot>((resolve) => (finishStart = resolve)),
    );

    const wakeRequest = request(server).post(`/pcs/${pc.id}/wake`).then((response) => response);
    await vi.waitFor(() => expect(wakeCoordinator.start).toHaveBeenCalledOnce());
    const deleteRequest = request(server).delete(`/pcs/${pc.id}`).then((response) => response);
    await new Promise((resolve) => setImmediate(resolve));
    expect(wakeCoordinator.cancel).not.toHaveBeenCalled();

    finishStart({ state: "waking" });
    await expect(wakeRequest).resolves.toMatchObject({ status: 200 });
    await expect(deleteRequest).resolves.toMatchObject({ status: 200 });
    expect(wakeCoordinator.cancel).toHaveBeenCalledWith(pc.id);
    expect(await repository.get(pc.id)).toBeUndefined();
  });
});
