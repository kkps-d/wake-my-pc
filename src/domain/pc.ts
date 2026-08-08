import { isIP } from "node:net";

import { z } from "zod";

import type { PcInput, PcRecord } from "../contracts.js";

const MAC_ADDRESS_PATTERN = /^(?:[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}|[0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5}|[0-9a-fA-F]{12})$/;

export const ipv4AddressSchema = z
  .string()
  .trim()
  .refine((value) => isIP(value) === 4, "Enter a valid IPv4 address.");

export const macAddressSchema = z
  .string()
  .trim()
  .refine(
    (value) => MAC_ADDRESS_PATTERN.test(value),
    "Enter a MAC address using 12 hexadecimal digits, with optional colons or hyphens.",
  )
  .transform(normalizeMacAddress);

export const pcInputSchema = z
  .object({
    name: z.string().trim().max(100, "Name must be 100 characters or fewer.").optional(),
    ipAddress: ipv4AddressSchema,
    macAddress: macAddressSchema,
  })
  .transform((value) => ({
    name: value.name || value.ipAddress,
    ipAddress: value.ipAddress,
    macAddress: value.macAddress,
  }));

export const pcRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  ipAddress: ipv4AddressSchema,
  macAddress: z.string().regex(/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/),
  createdAt: z.string().datetime({ offset: true }),
});

export const pcRecordsSchema = z.array(pcRecordSchema);

export type ValidatedPcInput = z.output<typeof pcInputSchema>;

/** Returns the canonical, colon-delimited MAC-address form. */
export function normalizeMacAddress(value: string): string {
  const hexadecimal = value.replaceAll(":", "").replaceAll("-", "").toUpperCase();
  return hexadecimal.match(/.{2}/g)?.join(":") ?? "";
}

/** Parses untrusted form input into the input accepted by the repository. */
export function validatePcInput(input: PcInput): ValidatedPcInput {
  return pcInputSchema.parse(input);
}
