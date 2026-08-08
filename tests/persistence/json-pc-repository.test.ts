import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DuplicatePcError, PcDataFileError, PcValidationError } from "../../src/domain/errors.js";
import { normalizeMacAddress } from "../../src/domain/pc.js";
import { JsonPcRepository } from "../../src/persistence/json-pc-repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("JsonPcRepository", () => {
  it("creates its parent directory and an empty, human-readable data file", async () => {
    const dataFilePath = await temporaryDataFilePath("nested/pcs.json");
    const repository = new JsonPcRepository(dataFilePath);

    await repository.initialize();

    expect(await repository.list()).toEqual([]);
    expect(await readFile(dataFilePath, "utf8")).toBe("[]\n");
  });

  it("persists records across repository restarts", async () => {
    const dataFilePath = await temporaryDataFilePath();
    const original = new JsonPcRepository(dataFilePath);
    const added = await original.add({
      name: "Office PC",
      ipAddress: "192.168.1.20",
      macAddress: "aa-bb-cc-dd-ee-ff",
    });

    const restarted = new JsonPcRepository(dataFilePath);

    await expect(restarted.list()).resolves.toEqual([added]);
  });

  it("defaults an empty name to the IP address and normalizes MAC formats", async () => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());

    const first = await repository.add({
      name: "   ",
      ipAddress: " 10.0.0.8 ",
      macAddress: "aabbccddeeff",
    });
    const second = await repository.add({
      name: "  Media center  ",
      ipAddress: "10.0.0.9",
      macAddress: "11:22:33:44:55:66",
    });

    expect(first).toMatchObject({
      name: "10.0.0.8",
      ipAddress: "10.0.0.8",
      macAddress: "AA:BB:CC:DD:EE:FF",
    });
    expect(second.name).toBe("Media center");
    expect(second.macAddress).toBe("11:22:33:44:55:66");
    expect(first.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it.each([
    ["999.0.0.1", "AA:BB:CC:DD:EE:FF"],
    ["example.test", "AA:BB:CC:DD:EE:FF"],
    ["2001:db8::1", "AA:BB:CC:DD:EE:FF"],
    ["10.0.0.1", "AA:BB:CC:DD:EE"],
    ["10.0.0.1", "AA-BB:CC-DD:EE-FF"],
    ["10.0.0.1", "AA:BB:CC:DD:EE:GG"],
  ])("rejects invalid PC input (%s, %s)", async (ipAddress, macAddress) => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());

    await expect(repository.add({ ipAddress, macAddress })).rejects.toBeInstanceOf(PcValidationError);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("rejects duplicate IP and MAC addresses after normalization", async () => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());
    await repository.add({ ipAddress: "10.0.0.4", macAddress: "AA-BB-CC-DD-EE-FF" });

    await expect(repository.add({ ipAddress: "10.0.0.4", macAddress: "11:22:33:44:55:66" })).rejects.toMatchObject({
      field: "ipAddress",
    } satisfies Partial<DuplicatePcError>);
    await expect(repository.add({ ipAddress: "10.0.0.5", macAddress: "aabbccddeeff" })).rejects.toMatchObject({
      field: "macAddress",
    } satisfies Partial<DuplicatePcError>);
  });

  it("removes existing PCs and reports whether an id was found", async () => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());
    const added = await repository.add({ ipAddress: "10.0.0.4", macAddress: "AA:BB:CC:DD:EE:FF" });

    await expect(repository.remove(added.id)).resolves.toBe(true);
    await expect(repository.remove(added.id)).resolves.toBe(false);
    await expect(repository.get(added.id)).resolves.toBeUndefined();
  });

  it("returns defensive record copies", async () => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());
    const added = await repository.add({ ipAddress: "10.0.0.4", macAddress: "AA:BB:CC:DD:EE:FF" });
    added.name = "Not saved";

    const listed = await repository.list();
    listed[0]!.name = "Also not saved";

    await expect(repository.get(added.id)).resolves.toMatchObject({ name: "10.0.0.4" });
  });

  it("never overwrites a malformed data file", async () => {
    const dataFilePath = await temporaryDataFilePath();
    const contents = "{ not valid JSON";
    await writeFile(dataFilePath, contents, "utf8");
    const repository = new JsonPcRepository(dataFilePath);

    await expect(repository.initialize()).rejects.toBeInstanceOf(PcDataFileError);
    await expect(repository.add({ ipAddress: "10.0.0.4", macAddress: "AA:BB:CC:DD:EE:FF" })).rejects.toBeInstanceOf(
      PcDataFileError,
    );
    await expect(readFile(dataFilePath, "utf8")).resolves.toBe(contents);
  });

  it("serializes concurrent adds so every valid PC is retained", async () => {
    const repository = new JsonPcRepository(await temporaryDataFilePath());

    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repository.add({
          name: `PC ${index}`,
          ipAddress: `10.0.0.${index + 10}`,
          macAddress: `02:00:00:00:00:${(index + 10).toString(16).padStart(2, "0")}`,
        }),
      ),
    );

    expect(new Set(created.map((record) => record.id))).toHaveLength(12);
    expect(await repository.list()).toHaveLength(12);
  });
});

describe("normalizeMacAddress", () => {
  it("produces uppercase colon-separated octets", () => {
    expect(normalizeMacAddress("aabbccddeeff")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normalizeMacAddress("aa-bb-cc-dd-ee-ff")).toBe("AA:BB:CC:DD:EE:FF");
  });
});

async function temporaryDataFilePath(filename = "pcs.json"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "wake-my-pc-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, filename);
}
