import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { AccountStore, TROPHY_RECEIPT_MAX, validTrophyTable } from '../server/accounts/store.js';
import { Accounts } from '../server/accounts/auth.js';
import { History } from '../server/accounts/history.js';
import { Backup } from '../server/accounts/backup.js';
import { createHistoryRecorder } from '../server/accounts/history-hook.js';
import { createAccountAuthority } from '../server/accounts/authority.js';
import { createApi } from '../server/http/api.js';

const quiet = { warn() {}, error() {}, info() {} };
const trophyPolicy = { version: 1, custom: false, multiplier: 1, reason: 'normal' };
function fixture(t) {
  const base = path.resolve(process.env.SP_TEST_TMP_DIR || os.tmpdir());
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'sp-account-trophies-'));
  const file = path.join(dir, 'accounts.json');
  const store = new AccountStore({ file, flushMs: 60000 });
  for (const accountId of ['alice', 'bob']) store.putProfile(accountId, {
    accountId, provider: 'password', nickname: accountId, discriminator: '0001', name: accountId + '#0001',
  });
  const accounts = new Accounts(store), history = new History(store);
  const backup = new Backup(store, { accounts, history });
  t.after(() => {
    store.close();
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), base);
    assert.ok(path.basename(target).startsWith('sp-account-trophies-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return { dir, file, store, accounts, history, backup };
}
const fact = (matchId, endedAt, trophies = 8) => ({ matchId, endedAt, trophies,
  status: 'completed', victory: true, mode: 'coop', difficulty: 'ABYSS', rounds: 15 });
const player = (accountId, trophies, extra = {}) => ({ accountId, trophies, alive: true, victory: true,
  seat: 0, name: accountId, lineup: [], stats: { kills: 12 }, ...extra });

test('legacy accounts start at zero; authoritative awards support half cups and persist across restart', t => {
  const { store, history, accounts, file } = fixture(t);
  const old = store.snapshot(); delete old.trophies;
  store.restore(old);
  assert.equal(accounts.profileOf('alice').totalTrophies, 0);
  assert.equal(history.summary('alice').totalTrophies, 0);
  assert.ok(history.recordOutcome('alice', fact('normal-win', 100, 8)));
  assert.ok(history.recordOutcome('alice', fact('custom-low', 101, 0.5)));
  assert.equal(accounts.meView('alice').totalTrophies, 8.5);
  assert.equal(history.get('alice', 'custom-low').trophies, 0.5);
  const reopened = new AccountStore({ file });
  try {
    assert.equal(reopened.totalTrophiesOf('alice'), 8.5);
    assert.equal(reopened.db.trophies.alice.totalHalfUnits, 17);
    assert.equal(new History(reopened).recordOutcome('alice', fact('normal-win', 100, 8)), null);
    assert.equal(reopened.totalTrophiesOf('alice'), 8.5);
  } finally { reopened.close(); }
});

test('only the settlement path awards cups; generic history/replay/import data cannot add them', t => {
  const { store, history, accounts, backup } = fixture(t);
  history.record('alice', { ...fact('old-import', 50, 9999), replay: 'untrusted replay' });
  assert.equal(accounts.profileOf('alice').totalTrophies, 0);
  assert.equal(history.recordOutcome('alice', fact('old-import', 50, 9999)), null, 'no retroactive old-match awards');
  history.recordOutcome('alice', fact('real', 100, 8));
  history.record('alice', { ...fact('replay-copy', 101, 5000), replay: 'fake' });
  assert.equal(store.totalTrophiesOf('alice'), 8);
  const snapshot = backup.exportAll();
  snapshot.db.history.alice.push(fact('imported-later', 200, 1000000));
  backup.importAll(snapshot, { dryRun: false });
  assert.equal(store.totalTrophiesOf('alice'), 8);
  for (const trophies of [-1, 0.1, 1.25, '8', Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    const id = 'bad-' + String(trophies);
    history.recordOutcome('bob', fact(id, 300, trophies));
    assert.equal(history.get('bob', id).trophies, 0);
  }
  assert.equal(store.totalTrophiesOf('bob'), 0);
  assert.equal(history.recordOutcome('bob', fact('bad--1', 300, 8)), null, 'a zero award is also a settled outcome');
  assert.equal(history.recordOutcome('alice', { ...fact('no-time', 300), endedAt: undefined }), null);
});

test('history trimming and receipt eviction never reset totals or let old stable outcomes add cups twice', t => {
  const { store, history, file } = fixture(t);
  for (let i = 1; i <= TROPHY_RECEIPT_MAX + 6; i++) {
    store.recordAccountOutcome('alice', history.clean(fact('match-' + i, 1000 + i, i === 1 ? 0.5 : 1)), 200);
  }
  store.flush();
  assert.equal(store.historyOf('alice').length, 200);
  assert.equal(store.db.trophies.alice.recent.length, TROPHY_RECEIPT_MAX);
  assert.equal(store.totalTrophiesOf('alice'), TROPHY_RECEIPT_MAX + 5.5);
  assert.equal(history.get('alice', 'match-1'), null);
  const reopened = new AccountStore({ file });
  try {
    const h = new History(reopened), before = reopened.totalTrophiesOf('alice');
    assert.equal(h.recordOutcome('alice', fact('match-1', 1001, 0.5)), null);
    assert.equal(h.recordOutcome('alice', fact('match-20', 1020, 1)), null, 'still in bounded ledger, no longer in history');
    assert.equal(h.recordOutcome('alice', fact('never-delivered-ancient', 1001, 8)), null, 'first arrival before evicted watermark is conservatively rejected');
    assert.equal(reopened.totalTrophiesOf('alice'), before);
    assert.ok(h.recordOutcome('alice', fact('late-but-in-window', 1200, 4)));
    assert.equal(reopened.totalTrophiesOf('alice'), before + 4);
  } finally { reopened.close(); }
});

test('same timestamp keys are deduplicated independently and cannot grow the ledger without bound', t => {
  const { store, history } = fixture(t);
  for (let i = 0; i <= TROPHY_RECEIPT_MAX; i++) {
    assert.equal(store.recordAccountOutcome('alice', history.clean(fact('tie-' + i, 5000, 0.5)), 200), true);
  }
  assert.equal(store.totalTrophiesOf('alice'), (TROPHY_RECEIPT_MAX + 1) / 2);
  assert.ok(store.db.trophies.alice.recent.length <= TROPHY_RECEIPT_MAX);
  assert.equal(store.db.trophies.alice.settledThrough, 5000);
  assert.equal(history.recordOutcome('alice', fact('tie-0', 5000, 0.5)), null);
  assert.equal(history.recordOutcome('alice', fact('tie-new-too-late', 5000, 0.5)), null);
  assert.ok(history.recordOutcome('alice', fact('next-tick', 5001, 0.5)));
});

test('history hook consumes authoritative per-player values, ignores bot/left players and preserves stable time', t => {
  const { store, history } = fixture(t);
  const record = createHistoryRecorder({ history, log: quiet, now: () => 99999 });
  const result = { endedAt: 7000, trophyPolicy, players: [player('alice', 8), player('bob', 4, { victory: false, alive: false }),
    player('alice', 90, { isBot: true }), player('bob', 90, { left: true })] };
  const meta = { matchId: 'stable', mode: 'coop', difficulty: 'ABYSS', rounds: 15 };
  assert.equal(record({ victory: true }, result, meta), 2);
  assert.equal(store.totalTrophiesOf('alice'), 8);
  assert.equal(store.totalTrophiesOf('bob'), 4, 'the server hook consumes the rule engine value, not a second rules calculation');
  assert.equal(history.get('bob', 'stable').victory, false);
  assert.equal(history.get('alice', 'stable').endedAt, 7000);
  assert.equal(history.get('alice', 'stable').rows[0].trophies, 8);
  assert.equal(record({ victory: true }, result, meta), 0);
  assert.equal(record({ victory: true }, { players: [player('alice', 8)] }, { matchId: 'legacy-no-time' }), 1);
  assert.equal(store.totalTrophiesOf('alice'), 8, 'legacy worker without stable endedAt does not receive guessed awards');
  assert.equal(record({ victory: true }, { endedAt: 7100, players: [player('alice', 6)] }, { matchId: 'legacy-no-policy' }), 1);
  assert.equal(store.totalTrophiesOf('alice'), 8, 'old rule worker with endedAt still does not receive new-policy awards');
  for (const [i, invalidPolicy] of [null, { ...trophyPolicy, version: 2 }, { ...trophyPolicy, custom: 'false' },
    { ...trophyPolicy, multiplier: 0.5 }, { ...trophyPolicy, reason: 'custom' }].entries()) {
    record({ victory: true }, { endedAt: 7200 + i, trophyPolicy: invalidPolicy, players: [player('alice', 8)] }, { matchId: 'bad-policy-' + i });
  }
  assert.equal(store.totalTrophiesOf('alice'), 8);
});

test('fixed gateway is the single writer and deduplicates cross-worker resends, including trimmed histories', t => {
  const { store, file } = fixture(t); store.close();
  const authority = createAccountAuthority({ file, log: quiet });
  try {
    authority.rpc('begin', { matchId: 'lease-a', accounts: ['alice'] }, 'release-a');
    const params = { leaseId: 'lease-a', outcome: { victory: true }, result: { endedAt: 8000, trophyPolicy, players: [player('alice', 8)] }, meta: { matchId: 'gateway-result' } };
    assert.equal(authority.rpc('finish', params, 'release-a'), 1);
    assert.equal(authority.rpc('finish', params, 'release-b'), 0);
    authority.store.db.history.alice = [];
    authority.store.markDirty();
    assert.equal(authority.rpc('finish', params, 'release-b'), 0);
    assert.equal(authority.store.totalTrophiesOf('alice'), 8);
  } finally { authority.close(); }
});

test('failed disk writes retry once without duplicate credit and survive reload after recovery', t => {
  const { store, history, dir, file } = fixture(t);
  store.flush();
  const goodTmp = store.tmp;
  store.tmp = dir; // opening a directory as the temp file fails on every platform
  const savedError = console.error; console.error = () => {};
  try {
    assert.throws(() => history.recordOutcome('alice', fact('disk-retry', 9000, 4)), /persisted/);
    assert.equal(store.totalTrophiesOf('alice'), 4);
    store.tmp = goodTmp;
    assert.equal(history.recordOutcome('alice', fact('disk-retry', 9000, 4)), null);
    assert.equal(store._dirty, false);
    const reloaded = new AccountStore({ file });
    try { assert.equal(reloaded.totalTrophiesOf('alice'), 4); } finally { reloaded.close(); }
  } finally { store.tmp = goodTmp; console.error = savedError; }
});

test('backup restore preserves awards and dedupe after history clearing; old backups remain compatible', t => {
  const { store, history, backup } = fixture(t);
  history.recordOutcome('alice', fact('before-backup', 10000, 8.5));
  const payload = backup.exportAll(); payload.db.history.alice = [];
  assert.equal(backup.check(payload).ok, true);
  store.restore({});
  backup.importAll(payload, { dryRun: false });
  assert.equal(store.totalTrophiesOf('alice'), 8.5);
  assert.equal(history.recordOutcome('alice', fact('before-backup', 10000, 8.5)), null);
  const broken = structuredClone(payload); broken.db.trophies.alice.recent[0].endedAt = -1;
  assert.equal(backup.check(broken).ok, false);
  assert.throws(() => backup.importAll(broken, { dryRun: false }), /BAD_BACKUP/);
  assert.equal(store.totalTrophiesOf('alice'), 8.5);
  const old = structuredClone(payload); delete old.db.trophies;
  assert.equal(backup.check(old).ok, true);
  backup.importAll(old, { dryRun: false });
  assert.equal(store.totalTrophiesOf('alice'), 0, 'restoring a legacy backup does not infer scores from history');
  assert.equal(validTrophyTable({ alice: { totalHalfUnits: 1.5, settledThrough: 0, recent: [] } }), false);
});

test('/api/me exposes only the total; ordinary client requests cannot award trophies', async t => {
  const { store, history, accounts } = fixture(t);
  history.recordOutcome('alice', fact('api-result', 11000, 0.5));
  const token = 'test-token-0123456789abcdef';
  store.putSession(token, { accountId: 'alice', createdAt: Date.now(), lastSeenAt: Date.now(), expiresAt: Date.now() + 60000 });
  const api = createApi({ accounts, history, log: quiet });
  async function request(method, rawPath, body = '') {
    const req = Readable.from(body ? [Buffer.from(body)] : []);
    req.method = method; req.headers = { authorization: 'Bearer ' + token };
    const res = { status: null, body: null, writeHead(status) { this.status = status; }, end(bytes) { this.body = bytes; } };
    const handled = await api(req, res, { rawPath, query: '' });
    return { ...res, handled };
  }
  const response = await request('GET', '/api/me');
  assert.equal(response.status, 200);
  const { profile } = JSON.parse(response.body);
  assert.equal(profile.totalTrophies, 0.5);
  assert.equal('recent' in profile || 'totalHalfUnits' in profile, false);
  const attempt = await request('POST', '/api/me/history', JSON.stringify(fact('forged', 12000, 999)));
  assert.equal(attempt.status, 404, 'no client settlement route exists');
  assert.equal(store.totalTrophiesOf('alice'), 0.5);
});
