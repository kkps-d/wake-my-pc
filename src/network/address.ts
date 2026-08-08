/** IPv4 and MAC helpers shared by the LAN networking adapters. */
export function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/** Returns an uppercase colon-delimited MAC address, or undefined when invalid. */
export function normalizeMacAddress(value: string): string | undefined {
  const compact = value.trim().replace(/[.:-]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(compact)) {
    return undefined;
  }

  return compact.toUpperCase().match(/.{2}/g)?.join(":");
}

export function ipv4ToNumber(address: string): number | undefined {
  if (!isIpv4(address)) {
    return undefined;
  }

  return address
    .split(".")
    .reduce((number, part) => ((number << 8) | Number(part)) >>> 0, 0);
}

export function numberToIpv4(value: number): string {
  const normalized = value >>> 0;
  return [24, 16, 8, 0]
    .map((shift) => String((normalized >>> shift) & 0xff))
    .join(".");
}
