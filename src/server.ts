import { createServer } from "node:http";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  CrossPlatformArpService,
  CrossPlatformPingService,
  InMemoryWakeCoordinator,
  NodeDgramWolService,
} from "./network/index.js";
import { JsonPcRepository } from "./persistence/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const repository = new JsonPcRepository(config.dataFile);
  await repository.initialize();

  const pingService = new CrossPlatformPingService();
  const arpService = new CrossPlatformArpService(pingService);
  const wolService = new NodeDgramWolService({
    broadcastAddress: config.wolBroadcastAddress,
  });
  const wakeCoordinator = new InMemoryWakeCoordinator(pingService, wolService);
  const app = createApp({ repository, arpService, wakeCoordinator });
  const server = createServer(app);

  server.listen(config.port, config.host, () => {
    console.log(`Wake My PC is available at http://${config.host}:${config.port}`);
  });

  let closing = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    console.log(`Received ${signal}; shutting down.`);
    wakeCoordinator.stop();
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
