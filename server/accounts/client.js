// Workers never open accounts.json. All mutations go through the gateway's IPC channel.
export function createAccountClient(channel = process) {
  if (typeof channel.send !== 'function') throw new Error('账号版必须由固定热更网关启动');
  const pending = new Map();
  let serial = 0, closed = false;
  const onMessage = message => {
    if (message?.type !== 'account.reply') return;
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer);
    if (message.error) job.reject(new Error(message.error)); else job.resolve(message.value);
  };
  const onDisconnect = () => {
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('账号服务连接已断开')); }
    pending.clear();
  };
  channel.on('message', onMessage);
  channel.on('disconnect', onDisconnect);
  function request(method, params) {
    if (closed || !channel.connected) return Promise.reject(new Error('账号服务不可用'));
    if (pending.size >= 1024) return Promise.reject(new Error('账号请求过多'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('账号服务响应超时')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      channel.send({ type: 'account.request', id, method, params }, error => {
        if (error && pending.has(id)) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    });
  }
  return {
    friendIds: accountId => request('friendIds', { accountId }),
    resolve: token => token ? request('resolve', { token }) : Promise.resolve(null),
    begin: (matchId, accounts) => request('begin', { matchId, accounts }),
    finish: (leaseId, outcome, result, meta) => request('finish', { leaseId, outcome, result, meta }),
    release: matchId => request('release', { matchId }),
    async close() {
      // Graceful retirement must deliver settlement writes before disconnecting IPC.
      const deadline = Date.now() + 11000;
      while (pending.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      closed = true; onDisconnect();
      channel.off('message', onMessage); channel.off('disconnect', onDisconnect);
    },
  };
}
