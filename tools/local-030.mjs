import path from 'node:path';
import { createInterface } from 'node:readline';
import { startGateway } from '../server/hot/gateway.mjs';

const root = path.resolve(import.meta.dirname, '..');
// Local acceptance uses an independent account database outside the release.
const gateway = await startGateway({ releaseRoot: root, port: Number(process.env.SP_LOCAL_PORT || 27630),
  host: '127.0.0.1', accountFile: path.resolve(root, '../private-local/accounts.json'), allowCreateAccounts: true,
  workerEnv: { SP_STUDIO: 'off', SP_PLUGINS: 'off', SP_PLUGIN_SCRIPTS: 'off', SP_MATCH_WORKERS: '2' },
});
console.log('LOCAL_030_READY http://127.0.0.1:' + gateway.port + '/');
createInterface({ input: process.stdin }).on('line', async line => {
  if (line.trim() === 'quit') { await gateway.close(); process.exit(0); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await gateway.close(); process.exit(0); });
