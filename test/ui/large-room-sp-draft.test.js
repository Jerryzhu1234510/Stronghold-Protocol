// Real match drafts must survive the wire -> client normalisation -> card-button path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA, makeMatch } from '../match/harness.js';
import { normalizeSp } from '../../public/js/ui/gameLogic/draft.js';
import { GameData } from '../../server/match/gamedata.js';
import { createRng } from '../../server/sim/rng.js';
import { generateDraft, cardView } from '../../server/match/choices.js';
import { PHASE } from '../../shared/constants.js';

const root = new URL('../../', import.meta.url);
globalThis.fetch = async url => {
  try {
    const body = readFileSync(new URL('data/' + String(url).split('/').pop(), root), 'utf8');
    return { ok: true, json: async () => JSON.parse(body) };
  } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const { data } = await import('../../public/js/data.js');
const { ChoiceView, cardPickable, spTap } = await import('../../public/js/ui/choiceOverlay.js');
await data.loadAll('items', 'effects', 'choices', 'assets', 'chess', 'bonds');

function* walk(v) {
  if (Array.isArray(v)) { for (const child of v) yield* walk(child); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (node, name) => String(node.props?.class || '').split(/\s+/).includes(name);
const buttons = (pub, sp, myId) => [...walk(ChoiceView({ pub, sp, myId, solo: false }))].filter(v => hasClass(v, 'spcard'));

for (const capacity of [4, 5, 6, 7, 8]) {
  test(`${capacity} players can each select from a real R3 bounty draft through the client UI`, () => {
    const h = makeMatch({ capacity, humans: capacity, difficulty: 'ABYSS', fake: true });
    const m = h.m;
    try {
      m.round = 3;
      m.enterSpDraft();
      assert.equal(m.sp.family, 'bounty');
      const count = Math.round(6 * Math.max(1, capacity / 4));
      assert.equal(m.sp.cards.length, count);
      for (let turn = 0; turn < capacity; turn++) {
        const pub = m.publicView();
        const sp = normalizeSp(pub.sp, pub.players);
        assert.equal(sp.cards.length, count, 'no server offers are hidden');
        assert.equal(sp.pickedCount, turn, 'later picks remain in the player badges');
        const myId = m.spTurn();
        const view = buttons(pub, sp, myId);
        assert.equal(view.length, count);
        const available = sp.cards.filter(card => cardPickable(sp, card, { myId, solo: false }));
        assert.equal(available.length, count - turn);
        // The 7th and 8th players explicitly pick former hidden slots 6 and 7.
        const card = available.find(c => c.idx === turn) || available[0];
        let tap = spTap(null, card.idx, true);
        tap = spTap(tap.armed, card.idx, true);
        assert.deepEqual(m.handle(myId, { t: 'g.choice', idx: tap.pick }), { ok: true });
        assert.equal(h.ps(myId).bounties.length, 1, 'the selected bounty actually reaches its player');
      }
      const pub = m.publicView();
      const sp = normalizeSp(pub.sp, pub.players);
      assert.equal(sp.pickedCount, capacity);
      assert.equal(Object.keys(m.sp.picks).length, capacity);
      assert.equal(sp.cards.filter(c => c.takenBy).length, capacity);
      h.sched.advance(1);
      assert.equal(m.phase, PHASE.PREP);
      assert.equal(h.logs.error.length, 0);
    } finally { m.dispose(); }
  });
}

for (const capacity of [5, 6, 7, 8]) {
  test(`${capacity}-seat UI keeps all offers in every generated draft family, even with only two survivors`, () => {
    const families = new Set();
    for (const mode of ['mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss']) {
      assert.ok(DATA.config.modes[mode]);
      const gd = new GameData(DATA, mode, { capacity });
      for (const round of gd.spRounds()) for (let seed = 1; seed <= 30; seed++) {
        const draft = generateDraft(gd, createRng(seed), round, { cardsMultiplier: capacity / 4 });
        if (!draft) continue;
        families.add(draft.family);
        const cards = draft.cards.map(cardView);
        const sp = normalizeSp({ ...draft, cards, order: ['p0', 'p1'], turn: 'p1', picks: { p0: 0 } },
          [{ playerId: 'p0' }, { playerId: 'p1' }]);
        assert.equal(sp.cards.length, cards.length, `${mode} R${round} ${draft.family}`);
        assert.deepEqual(sp.cards.map(c => c.idx), cards.map((_, idx) => idx));
      }
    }
    assert.deepEqual([...families].sort(), ['bounty', 'shop', 'supply', 'tactic']);
  });
}

test('eight-player timeout assigns every participant, including the last two', () => {
  const h = makeMatch({ capacity: 8, humans: 8, difficulty: 'ABYSS', fake: true });
  try {
    h.m.round = 3;
    h.m.enterSpDraft();
    const draft = h.m.sp;
    assert.ok(h.run(() => h.m.phase === PHASE.PREP));
    assert.equal(Object.keys(draft.picks).length, 8);
    const sp = normalizeSp({ ...draft, turn: null }, h.m.publicView().players);
    assert.equal(sp.pickedCount, 8);
    for (const player of h.m.order) assert.equal(player.bounties.length, 1);
  } finally { h.m.dispose(); }
});
