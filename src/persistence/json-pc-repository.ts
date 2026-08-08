import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import writeFileAtomic from "write-file-atomic";
import { ZodError } from "zod";

import type { PcInput, PcRecord, PcRepository } from "../contracts.js";
import { pcRecordsSchema, validatePcInput } from "../domain/pc.js";
import { DuplicatePcError, PcDataFileError, PcValidationError } from "../domain/errors.js";

/**
 * A small, serialized JSON-backed PC repository. Every mutating operation reads,
 * validates, then atomically replaces the entire file so a bad file is never
 * silently replaced with an empty one.
 */
export class JsonPcRepository implements PcRepository {
  private initialization: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly dataFilePath: string) {}

  public initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.serialize(async () => {
        await mkdir(dirname(this.dataFilePath), { recursive: true });

        try {
          await this.readRecords();
        } catch (error: unknown) {
          if (isFileNotFoundError(error)) {
            await this.writeRecords([]);
            return;
          }

          throw error;
        }
      });
    }

    return this.initialization;
  }

  public async list(): Promise<PcRecord[]> {
    await this.initialize();
    return cloneRecords(await this.readRecords());
  }

  public async get(id: string): Promise<PcRecord | undefined> {
    await this.initialize();
    const record = (await this.readRecords()).find((candidate) => candidate.id === id);
    return record ? { ...record } : undefined;
  }

  public async add(input: PcInput): Promise<PcRecord> {
    await this.initialize();

    let validatedInput;
    try {
      validatedInput = validatePcInput(input);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        throw new PcValidationError(error.issues);
      }

      throw error;
    }

    return this.serialize(async () => {
      const records = await this.readRecords();
      if (records.some((record) => record.ipAddress === validatedInput.ipAddress)) {
        throw new DuplicatePcError("ipAddress");
      }
      if (records.some((record) => record.macAddress === validatedInput.macAddress)) {
        throw new DuplicatePcError("macAddress");
      }

      const record: PcRecord = {
        id: randomUUID(),
        name: validatedInput.name,
        ipAddress: validatedInput.ipAddress,
        macAddress: validatedInput.macAddress,
        createdAt: new Date().toISOString(),
      };
      records.push(record);
      await this.writeRecords(records);
      return { ...record };
    });
  }

  public async remove(id: string): Promise<boolean> {
    await this.initialize();

    return this.serialize(async () => {
      const records = await this.readRecords();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) {
        return false;
      }

      records.splice(index, 1);
      await this.writeRecords(records);
      return true;
    });
  }

  private async readRecords(): Promise<PcRecord[]> {
    let contents: string;
    try {
      contents = await readFile(this.dataFilePath, "utf8");
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        throw error;
      }
      throw new PcDataFileError(this.dataFilePath, error);
    }

    try {
      return pcRecordsSchema.parse(JSON.parse(contents));
    } catch (error: unknown) {
      throw new PcDataFileError(this.dataFilePath, error);
    }
  }

  private async writeRecords(records: PcRecord[]): Promise<void> {
    await writeFileAtomic(this.dataFilePath, `${JSON.stringify(records, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function cloneRecords(records: PcRecord[]): PcRecord[] {
  return records.map((record) => ({ ...record }));
}
