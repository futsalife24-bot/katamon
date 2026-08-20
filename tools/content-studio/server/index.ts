import { createServer } from 'node:http';

import { createApiHandler } from './app.js';
import { loadConfig } from './config.js';

try {
  process.loadEnvFile?.();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'ENOENT') throw error;
}

const config = loadConfig();
if (process.env.NODE_ENV === 'production' && !config.configured) {
  throw new Error(`Content Studio backend configuration is incomplete: ${config.configurationErrors.join(', ')}`);
}

const handler = createApiHandler({ config });
const server = createServer((request, response) => {
  void handler(request, response);
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, config.host, () => {
  const mode = config.configured ? 'GitHub integration enabled' : 'GitHub integration disabled';
  console.info(JSON.stringify({
    at: new Date().toISOString(),
    event: 'server.started',
    outcome: 'success',
    requestId: 'startup',
    details: { address: `http://${config.host}:${config.port}`, mode },
  }));
});
