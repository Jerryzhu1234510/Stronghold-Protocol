import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Each release has its own module graph, data, rooms and sockets. Never reload modules in a live match.
const root = process.argv[2];
const { startServer } = await import(pathToFileURL(path.join(root, 'server/index.js')));
const options = { host: '127.0.0.1', port: 0, quiet: true, trustProxy: true };
if (process.env.SP_HOT_TEST_STUB === '1') options.MatchClass = (await import(pathToFileURL(path.join(root, 'server/match/StubMatch.js')))).StubMatch;
const srv = await startServer(options);
if (typeof srv.beginDrain !== 'function') { await srv.close(); throw new Error('该版本尚未适配不中断更新协议'); }
process.send?.({ type: 'ready', port: srv.port });
process.on('message', async (msg) => {
  if (msg?.type === 'drain') { srv.beginDrain(); process.send?.({ type: 'drained' }); }
  if (msg?.type === 'resume') srv.cancelDrain();
  if (msg?.type === 'announce') srv.announcements.command(msg.line);
  if (msg?.type === 'stop') { await srv.close(); process.exit(0); }
});
process.once('disconnect', async () => { await srv.close(); process.exit(0); });
