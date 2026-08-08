import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const requireSameOrigin: RequestHandler = (request, response, next) => {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const fetchSite = request.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    response.status(403).send("Cross-site requests are not allowed.");
    return;
  }

  const origin = request.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== request.get("host")) {
        response.status(403).send("Cross-site requests are not allowed.");
        return;
      }
    } catch {
      response.status(403).send("Invalid Origin header.");
      return;
    }
  }

  next();
};
