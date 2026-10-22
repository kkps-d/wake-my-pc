const host = process.env.HOST?.trim() || "0.0.0.0";
const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
const authority = target.includes(":") ? `[${target}]` : target;
try {
  const response = await fetch(`http://${authority}:${process.env.PORT || 3000}/healthz`, {
    signal: AbortSignal.timeout(4000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
