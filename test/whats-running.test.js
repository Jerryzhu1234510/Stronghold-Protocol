// test/whats-running.test.js — tools/whats-running.mjs：认出「端口上跑的是哪一份副本」。
//
// 这个脚本存在的理由就是本次踩到的坑：启动器探到端口上有「本游戏的服务器」时只会打开浏览器，而它认不出那是
// 另一个目录里的旧副本。所以这里的重点有两处：
//   * 纯函数（端口清单、netstat 解析、与当前目录的比对、命令行里的项目目录）—— 不依赖本机有什么在跑；
//   * 一次真服务器：起一个实例，确认脚本能认出它的版本、前端指纹与「就是本目录」的关系。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePorts, parseNetstat, classifyInstance, projectDirOf, inspectPort, formatUptime, formatStarted, DEFAULT_PORTS } from '../tools/whats-running.mjs';
import { startServer, computeBuildTag } from '../server/index.js';
import { APP_VERSION } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = { app: APP_VERSION, build: 'aaaaaaaaaaaa' };

describe('tools/whats-running.mjs', () => {
  test('parsePorts: 默认端口、单个端口、区间、--port/--range，去重保序', () => {
    assert.deepEqual(parsePorts([]), [...DEFAULT_PORTS], '不带参数扫默认端口');
    assert.deepEqual(parsePorts(['3000']), [3000]);
    assert.deepEqual(parsePorts(['3001', '3000']), [3001, 3000], '保序');
    assert.deepEqual(parsePorts(['3000-3003']), [3000, 3001, 3002, 3003]);
    assert.deepEqual(parsePorts(['--range', '3002-3003']), [3002, 3003]);
    assert.deepEqual(parsePorts(['--port=3005']), [3005]);
    assert.deepEqual(parsePorts(['3000', '3000']), [3000], '去重');
    assert.deepEqual(parsePorts(['--help', 'nonsense']), [...DEFAULT_PORTS], '认不出的参数忽略');
    assert.deepEqual(parsePorts(['0', '70000']), [...DEFAULT_PORTS], '越界的端口丢掉');
    assert.ok(parsePorts(['3000-9999']).length <= 64, '一次不会扫爆端口');
    assert.deepEqual(parsePorts(['3003-3001']), [3001, 3002, 3003], '倒着写也认');
  });

  test('parseNetstat: 只看 TCP 的 LISTENING 行，IPv4 / IPv6 都认', () => {
    const sample = [
      '',
      '活动连接',
      '',
      '  协议  本地地址          外部地址        状态           PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       47492',
      '  TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       49384',
      '  TCP    [::]:3000              [::]:0                 LISTENING       47492',
      '  TCP    127.0.0.1:54321        127.0.0.1:3000         ESTABLISHED     1234',
      '  UDP    0.0.0.0:5353           *:*                                    9999',
      '',
    ].join('\r\n');
    const owners = parseNetstat(sample);
    assert.equal(owners.get(3000), 47492, '监听 3000 的进程');
    assert.equal(owners.get(3001), 49384);
    assert.equal(owners.has(54321), false, 'ESTABLISHED 不算');
    assert.equal(owners.has(5353), false, 'UDP 不算');
    assert.equal(owners.size, 2);
  });

  test('classifyInstance: 版本不同 / 前端不同 / 一致 / 没报指纹', () => {
    assert.equal(classifyInstance({ app: APP_VERSION, build: 'aaaaaaaaaaaa' }, LOCAL), 'same');
    assert.equal(classifyInstance({ app: '0.1.3', build: 'bbbbbbbbbbbb' }, LOCAL), 'other-version');
    assert.equal(classifyInstance({ app: APP_VERSION, build: 'bbbbbbbbbbbb' }, LOCAL), 'other-frontend');
    assert.equal(classifyInstance({ app: APP_VERSION }, LOCAL), 'unknown');
    assert.equal(classifyInstance({}, LOCAL), 'other-version', '版本未知也当成另一份');
  });

  test('projectDirOf: 带引号的 node.exe 不会污染目录；相对路径认不出', () => {
    assert.equal(
      projectDirOf('"C:\\Program Files\\nodejs\\node.exe" D:\\weishuxieyi\\Stronghold-Protocol-v0.1.4\\Stronghold-Protocol\\server\\index.js'),
      'D:\\weishuxieyi\\Stronghold-Protocol-v0.1.4\\Stronghold-Protocol',
    );
    assert.equal(projectDirOf('node server/index.js'), null, '相对路径：认不出是哪个目录');
    assert.equal(projectDirOf('/usr/bin/node /srv/game/server/index.js'), '/srv/game');
    assert.equal(projectDirOf('"C:\\a b\\node.exe" "C:\\my games\\sp\\server\\index.js"'), 'C:\\my games\\sp');
    assert.equal(projectDirOf(''), null);
    assert.equal(projectDirOf(null), null);
  });

  test('formatUptime / formatStarted: 给人看的写法', () => {
    assert.equal(formatUptime(5), '5 s');
    assert.equal(formatUptime(193), '3.2 min（193 s）');
    assert.equal(formatUptime(16356), '4.5 h（16356 s）');
    assert.equal(formatUptime(NaN), '?');
    assert.match(formatStarted('2026-10-06T21:36:09.000Z'), /^2026-10-0[67] \d\d:\d\d:\d\d$/);
    assert.equal(formatStarted(null), null);
  });

  test('认出端口上真实的服务器：版本、前端指纹与「就是本目录」', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    try {
      const local = { app: APP_VERSION, build: computeBuildTag(ROOT) };
      const info = await inspectPort(srv.port, local);
      assert.equal(info.state, 'ours', '本游戏的服务器');
      assert.equal(info.health.app, APP_VERSION, '/healthz 报的版本');
      assert.equal(info.relation, 'same', '与本地前端指纹一致');
      assert.ok(info.health.uptimeSec >= 0);
      // 进程信息是加分项：能拿到就该指向一个 node 进程
      if (info.pid != null) assert.equal(typeof info.pid, 'number');
      if (info.process?.name) assert.match(info.process.name, /node/i);
    } finally {
      await srv.close();
    }
  });

  test('空闲的端口不会被当成本游戏的实例', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const freePort = srv.port;
    await srv.close();
    const info = await inspectPort(freePort, LOCAL);
    assert.equal(info.state, 'free', `端口 ${freePort} 应该是空闲的`);
    assert.equal(info.relation, null);
  });
});
