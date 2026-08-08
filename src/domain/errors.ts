import type { PcInput } from "../contracts.js";
import type { z } from "zod";

export class PcValidationError extends Error {
  public readonly issues: z.ZodIssue[];
  /** First validation message for each form field, ready for inline rendering. */
  public readonly fieldErrors: Partial<Record<keyof PcInput, string>>;

  public constructor(issues: z.ZodIssue[]) {
    super("The PC details are invalid.");
    this.name = "PcValidationError";
    this.issues = issues;
    this.fieldErrors = issues.reduce<Partial<Record<keyof PcInput, string>>>((errors, issue) => {
      const field = issue.path[0];
      if (
        (field === "name" || field === "ipAddress" || field === "macAddress") &&
        errors[field] === undefined
      ) {
        errors[field] = issue.message;
      }
      return errors;
    }, {});
  }
}

export class DuplicatePcError extends Error {
  public constructor(public readonly field: "ipAddress" | "macAddress") {
    super(`A PC with this ${field === "ipAddress" ? "IP address" : "MAC address"} already exists.`);
    this.name = "DuplicatePcError";
  }
}

/** The configured data file exists but does not contain valid PC records. */
export class PcDataFileError extends Error {
  public constructor(public readonly filePath: string, cause?: unknown) {
    super(`The PC data file at ${filePath} is malformed and was not changed.`);
    this.name = "PcDataFileError";
    this.cause = cause;
  }
}
