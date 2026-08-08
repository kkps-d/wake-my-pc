import { isIP } from "node:net";
import path from "node:path";

import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";

import type {
  ArpService,
  PcInput,
  PcRecord,
  PcRepository,
  StatusSnapshot,
  WakeCoordinator,
} from "./contracts.js";
import { DuplicatePcError, PcValidationError } from "./persistence/index.js";
import { requireSameOrigin } from "./http/same-origin.js";

export interface AppDependencies {
  repository: PcRepository;
  arpService: ArpService;
  wakeCoordinator: WakeCoordinator;
  projectRoot?: string;
}

interface AddFormValues {
  name: string;
  ipAddress: string;
  macAddress: string;
}

const checkingStatus: StatusSnapshot = { state: "checking" };

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  const projectRoot = dependencies.projectRoot ?? process.cwd();
  const pcOperations = new KeyedOperationQueue();

  app.disable("x-powered-by");
  app.set("view engine", "ejs");
  app.set("views", path.join(projectRoot, "src/views"));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use("/assets", express.static(path.join(projectRoot, "src/public"), { fallthrough: false }));
  app.use(
    "/vendor",
    express.static(path.join(projectRoot, "node_modules/htmx.org/dist"), {
      fallthrough: false,
      immutable: true,
      maxAge: "1d",
    }),
  );
  app.use(requireSameOrigin);

  app.get("/", async (_request, response, next) => {
    try {
      const pcs = await dependencies.repository.list();
      response.render("pages/index", { pcs, statuses: initialStatuses(pcs) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/pcs/new", (_request, response) => {
    response.render("partials/add-form", {
      values: emptyFormValues(),
      errors: {},
      formError: undefined,
    });
  });

  app.post("/network/resolve-mac", async (request, response, next) => {
    const ipAddress = stringValue(request.body.ipAddress).trim();
    const currentMac = stringValue(request.body.macAddress).trim();

    if (isIP(ipAddress) !== 4) {
      response.render("partials/mac-field", {
        value: currentMac,
        error: "Enter a valid IPv4 address before finding the MAC address.",
        message: undefined,
      });
      return;
    }

    try {
      const macAddress = await dependencies.arpService.resolve(ipAddress);
      response.render("partials/mac-field", {
        value: macAddress ?? currentMac,
        error: macAddress
          ? undefined
          : "No MAC address was found. Make sure the PC is awake and on this LAN, or enter it manually.",
        message: macAddress ? "MAC address found on the local network." : undefined,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/pcs", async (request, response, next) => {
    const values = formValues(request);
    const input: PcInput = values;

    try {
      await dependencies.repository.add(input);
      const pcs = await dependencies.repository.list();
      response.set({
        "HX-Retarget": "#pc-list",
        "HX-Reswap": "outerHTML",
        "HX-Trigger": "closeAddDialog",
      });
      response.render("partials/pc-list", { pcs, statuses: initialStatuses(pcs) });
    } catch (error) {
      if (error instanceof PcValidationError) {
        response.status(200).render("partials/add-form", {
          values,
          errors: error.fieldErrors,
          formError: error.message,
        });
        return;
      }
      if (error instanceof DuplicatePcError) {
        response.status(200).render("partials/add-form", {
          values,
          errors: { [error.field]: error.message },
          formError: error.message,
        });
        return;
      }
      next(error);
    }
  });

  app.get("/pcs/:id/status", async (request, response, next) => {
    try {
      const pc = await dependencies.repository.get(request.params.id);
      if (!pc) {
        response.status(404).send("");
        return;
      }
      const status = await dependencies.wakeCoordinator.getStatus(pc);
      response.render("partials/pc-controls", { pc, status });
    } catch (error) {
      next(error);
    }
  });

  app.post("/pcs/:id/wake", async (request, response, next) => {
    try {
      const result = await pcOperations.run(request.params.id, async () => {
        const pc = await dependencies.repository.get(request.params.id);
        if (!pc) return undefined;
        return { pc, status: await dependencies.wakeCoordinator.start(pc) };
      });
      if (!result) {
        response.status(404).send("PC not found.");
        return;
      }
      response.render("partials/pc-controls", result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/pcs/:id/delete-confirm", async (request, response, next) => {
    try {
      const pc = await dependencies.repository.get(request.params.id);
      if (!pc) {
        response.status(404).render("partials/error", { message: "That PC no longer exists." });
        return;
      }
      response.render("partials/delete-confirm", { pc });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/pcs/:id", async (request, response, next) => {
    try {
      const removed = await pcOperations.run(request.params.id, async () => {
        dependencies.wakeCoordinator.cancel(request.params.id);
        return dependencies.repository.remove(request.params.id);
      });
      if (!removed) {
        response.status(404).send("PC not found.");
        return;
      }
      response.set("HX-Trigger", "closeDeleteDialog").status(200).send("");
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).render("partials/error", {
      title: "Page not found",
      message: "The requested page does not exist.",
    });
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    console.error(error);
    const message = "Wake My PC could not complete that request. Please try again.";
    if (request.get("HX-Request") === "true") {
      response.status(500).render("partials/error", { message });
      return;
    }
    response.status(500).render("partials/error", { title: "Something went wrong", message });
  };
  app.use(errorHandler);

  return app;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formValues(request: Request): AddFormValues {
  return {
    name: stringValue(request.body.name),
    ipAddress: stringValue(request.body.ipAddress),
    macAddress: stringValue(request.body.macAddress),
  };
}

function emptyFormValues(): AddFormValues {
  return { name: "", ipAddress: "", macAddress: "" };
}

function initialStatuses(pcs: PcRecord[]): Record<string, StatusSnapshot> {
  return Object.fromEntries(pcs.map((pc) => [pc.id, checkingStatus]));
}

class KeyedOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  public run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.finally(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }
}
