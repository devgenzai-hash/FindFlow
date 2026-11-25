import { config } from './config.js';
import { buildServer } from './server.js';

const app = await buildServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Trendsetter server listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}