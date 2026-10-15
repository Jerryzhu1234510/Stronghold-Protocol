import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { PHASE, ERR, largeRoomBonus } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { bandPickBlocked, bandRepeatUsage } from '../../shared/draftRules.js';
import { createRng } from '../../server/sim/rng.js';

for (const capacity of [4, 5, 6, 7, 8]) {
  test(`${capacity} seats: extra shop slots and random bond bans follow the selected capacity`, () => {
    const bonus = largeRoomBonus(capacity);
    for (const difficulty of ['funny', 'normal', 'hard', 'abyss']) {
      const base = new GameData(DATA, `mode_multi_${difficulty}`);
      const gd = new GameData(DATA, `mode_multi_${difficulty}`, { capacity });
      for (let level = 1; level <= 6; level++) {
        assert.deepEqual(gd.shopSlots(level), { chess: base.shopSlots(level).chess + bonus, item: base.shopSlots(level).item });
      }
      const bans = base.bans(difficulty.toUpperCase());
      assert.deepEqual(gd.bans(difficulty.toUpperCase()), { core: Math.max(0, bans.core - bonus), addon: Math.max(0, bans.addon - bonus) });
      assert.deepEqual([...gd.modeInactiveBonds], [...base.modeInactiveBonds], 'static difficulty restrictions stay fixed');
    }
    const h = makeMatch({ capacity, humans: 1, fake: true, difficulty: 'NORMAL' }).start();
    const m = h.m;
    const drawn = m.disabledBonds.map(id => m.gd.bond(id));
    assert.equal(drawn.filter(b => b.isCore).length, 3 - bonus);
    assert.equal(drawn.filter(b => !b.isCore).length, 4 - bonus);
    h.toPrep(1);
    const ps = h.ps('p_0');
    assert.equal(ps.shop.slots.filter(s => s?.kind === 'chess').length, m.gd.shopSlots(1).chess);
    ps.shop.level = 6; ps.rollShop();
    assert.equal(ps.shop.slots.filter(s => s?.kind === 'chess').length, 5 + bonus);
    const item = ps.shop.slots.at(-1);
    ps.freeze(); ps.rollShop({ keepFrozen: true });
    assert.equal(ps.shop.slots.at(-1).id, item.id, 'equipment remains in its own segment when frozen');
    h.invariants(); m.dispose();
  });
}

test('solo ignores multiplayer recruitment and ban bonuses', () => {
  const h = makeMatch({ mode: 'solo', capacity: 8, fake: true });
  assert.equal(h.m.gd.largeRoomBonus, 0);
  assert.deepEqual(h.m.gd.shopSlots(6), new GameData(DATA, 'mode_single_normal').shopSlots(6));
  h.start(); h.toPrep(1);
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: null }).error, ERR.BAD_TARGET);
  h.m.dispose();
});

test('small bonds and core bonds can be chosen; unavailable/unknown bonds and invalid phases are refused', () => {
  const h = makeMatch({ capacity: 8, humans: 1, fake: true }).start();
  const ps = h.ps('p_0');
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: 'yanShip' }).error, ERR.WRONG_PHASE);
  h.toPrep(1);
  const options = ps.shopFocusOptions();
  const core = options.find(id => h.m.gd.bond(id).isCore);
  const small = options.find(id => !h.m.gd.bond(id).isCore);
  assert.ok(core && small);
  const before = JSON.stringify(ps.shop.slots), funds = ps.funds;
  for (const id of [core, small, null]) assert.deepEqual(h.m.handle('p_0', { t: 'g.shopFocus', bondId: id }), { ok: true });
  assert.equal(JSON.stringify(ps.shop.slots), before, 'switching does not reroll or unfreeze cards');
  assert.equal(ps.funds, funds, 'switching does not change the economy');
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: 'missing' }).error, ERR.BAD_TARGET);
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: h.m.disabledBonds[0] }).error, ERR.BAD_TARGET);
  h.m.handle('p_0', { t: 'g.shopFocus', bondId: small });
  assert.equal(ps.privateView().shop.focusBondId, small);
  ps.ready = true;
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: null }).error, ERR.WRONG_PHASE);
  ps.ready = false; ps.alive = false;
  assert.equal(h.m.handle('p_0', { t: 'g.shopFocus', bondId: null }).error, ERR.ELIMINATED);
  h.m.dispose();
});

test('only the first added slot gets the 50% branch; choosing/frozen offers do not consume any random draws', () => {
  const h = makeMatch({ capacity: 8, fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'); ps.shop.level = 6;
  const focus = ps.shopFocusOptions()[0];
  ps.setShopFocus(focus);
  const original = h.m.pool.roll.bind(h.m.pool);
  let targeted = 0;
  h.m.pool.roll = (rng, opts) => { if (opts.filter) targeted++; return original(rng, opts); };
  h.m.rngShop = () => .25;
  ps.rollShop();
  assert.equal(targeted, 1);
  const firstAdded = new GameData(DATA, 'mode_multi_normal').shopSlots(6).chess;
  assert.ok(h.m.gd.chess(ps.shop.slots[firstAdded].id).bonds.includes(focus));
  targeted = 0; ps.freeze(); ps.rollShop({ keepFrozen: true });
  assert.equal(targeted, 0, 'frozen cards survive without additional focus chances');
  h.m.rngShop = () => .75; ps.rollShop();
  assert.equal(targeted, 0, 'the other 50% is a normal roll');
  h.invariants(); h.m.dispose();
});

test('focus respects tier, inventory and own support choices, and falls back instead of leaving an empty slot', () => {
  const h = makeMatch({ capacity: 8, fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'); ps.shop.level = 1;
  const focus = ps.shopFocusOptions()[0]; ps.setShopFocus(focus);
  h.m.rngShop = () => .25;
  for (const [id] of h.m.pool.entries) if (h.m.gd.chess(id).bonds?.includes(focus)) h.m.pool.take(id, 999);
  const rolled = ps._rollChessSlot({ focus: true });
  assert.ok(rolled);
  assert.equal(h.m.gd.tierOf(rolled.id), 1);
  assert.ok(h.m.pool.left(rolled.id) > 0);
  assert.ok(!h.m.gd.chess(rolled.id).isSupport);
  const snapshot = h.m.pool.snapshot();
  ps.rollShop();
  assert.deepEqual(h.m.pool.snapshot(), snapshot, 'displaying shop cards reserves no copies');
  h.m.dispose();
});

test('fixed-seed focus frequency agrees with a 50% targeted branch plus ordinary random hits', () => {
  const h = makeMatch({ capacity: 8, fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'); ps.shop.level = 6;
  const focus = ps.shopFocusOptions().find(id => h.m.gd.bond(id).isCore);
  ps.setShopFocus(focus);
  const candidates = h.m.pool._eligible({ maxTier: 6, supportIds: ps.supportIds });
  const total = candidates.reduce((s, [, n]) => s + n, 0);
  const focused = candidates.filter(([id]) => h.m.gd.chess(id).bonds.includes(focus)).reduce((s, [, n]) => s + n, 0);
  const expected = .5 + .5 * focused / total;
  h.m.rngShop = createRng(170107);
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (h.m.gd.chess(ps._rollChessSlot({ focus: true }).id).bonds.includes(focus)) hits++;
  assert.ok(Math.abs(hits / 4000 - expected) < .025, `${hits / 4000} vs ${expected}`);
  h.m.dispose();
});

for (const capacity of [4, 5, 6, 7, 8]) test(`${capacity} seats: shared duplicate allowance, two-pick cap, and UI rule match server`, () => {
  const h = makeMatch({ capacity, humans: capacity, fake: true }).start(), m = h.m;
  for (const ps of m.order) m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(m.phase, PHASE.BAND_DRAFT);
  const pick = id => m.handle(m.draftTurn(), { t: 'g.band', bandId: id });
  const a = 'band_sarkazb', b = 'band_amiya', c = 'band_lisa';
  assert.deepEqual(pick(a), { ok: true });
  const limit = largeRoomBonus(capacity);
  assert.equal(bandPickBlocked(m.draft.picks, a, { playerId: m.draftTurn(), repeatLimit: limit }), !limit);
  if (limit) {
    assert.deepEqual(pick(a), { ok: true });
    assert.equal(pick(a).error, ERR.BAD_TARGET, 'never allow a third pick of the same opening');
  } else assert.equal(pick(a).error, ERR.BAD_TARGET);
  assert.deepEqual(pick(b), { ok: true });
  if (limit === 2) assert.deepEqual(pick(b), { ok: true });
  else assert.equal(pick(b).error, ERR.BAD_TARGET);
  assert.deepEqual(pick(c), { ok: true });
  if (m.phase === PHASE.BAND_DRAFT) assert.equal(pick(c).error, ERR.BAD_TARGET, 'room-wide quota is exhausted');
  assert.equal(bandRepeatUsage(m.draft.picks), limit);
  for (const id of m.gd.bandIds()) assert.equal(m.bandTaken(id, m.draftTurn()),
    bandPickBlocked(m.draft.picks, id, { playerId: m.draftTurn(), repeatLimit: limit }));
  h.m.dispose();
});

test('highlighted timeout uses an available duplicate, but not a third copy or an exhausted allowance', () => {
  const h = makeMatch({ capacity: 5, humans: 5, fake: true }).start(), m = h.m;
  for (const ps of m.order) m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  m.handle(m.draftTurn(), { t: 'g.band', bandId: 'band_amiya' });
  const next = m.draftTurn();
  m.handle(next, { t: 'g.bandFocus', bandId: 'band_amiya' });
  assert.equal(m.timeoutBand(next), 'band_amiya');
  m._applyBand(m.players.get(next), m.timeoutBand(next));
  const third = m.draftTurn();
  m.handle(third, { t: 'g.bandFocus', bandId: 'band_amiya' });
  assert.notEqual(m.timeoutBand(third), 'band_amiya');
  assert.equal(m.publicView().draft.repeatUsed, 1);
  assert.equal(m.publicView().draft.repeatLimit, 1);
  m.dispose();
});

test('shop-focus protocol accepts a bond ID or null only', () => {
  assert.equal(validateC2S({ t: 'g.shopFocus', bondId: 'swiftShip' }), null);
  assert.equal(validateC2S({ t: 'g.shopFocus', bondId: null }), null);
  for (const bondId of ['', undefined, 1, {}, '__proto__ x']) assert.ok(validateC2S({ t: 'g.shopFocus', bondId }));
});

test('eight-seat bots prefer unused openings rather than spending the shared repeat allowance', () => {
  const h = makeMatch({ capacity: 8, humans: 1, bots: 7, fake: true }).start();
  h.toPrep(1);
  assert.equal(new Set(h.m.order.map(ps => ps.bandId)).size, 8);
  assert.equal(bandRepeatUsage(h.m.draft?.picks), 0);
  h.invariants(); h.m.dispose();
});
