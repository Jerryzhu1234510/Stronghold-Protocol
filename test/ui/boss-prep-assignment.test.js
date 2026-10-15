import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepCamera, deployFieldOf, foldCamera, fieldTile } from '../../public/js/ui/gameLogic/camera.js';
import { bossPrepField } from '../../public/js/render/prepfield.js';

const pub = { round: 14, bossRound: 14, hiddenRound: 15, players: [{ playerId: 'a', seat: 0, alive: false }, { playerId: 'b', seat: 1, alive: true }] };
const priv = { playerId: 'b', alive: true, prepField: { kind: 'bossPrep', side: 'R', round: 14 } };
test('boss prep uses the server-frozen right half even after the left player leaves', () => {
  assert.equal(prepCamera(pub, 'b', priv).opts.side, 'R');
  assert.equal(deployFieldOf(pub, 'b', priv), 'bossR');
  const xf = bossPrepField(prepCamera(pub, 'b', priv).opts.side);
  assert.deepEqual(xf.toDisp(10, 3), { row: 3, col: 17 });
  assert.equal(xf.dirToDisp('RIGHT'), 'LEFT');
  assert.deepEqual(xf.toBoard(3, 17), { row: 10, col: 3 });
  assert.deepEqual(fieldTile(deployFieldOf(pub, 'b', priv), 10, 3), [3, 17]);
  assert.equal(prepCamera(pub, 'b', { ...priv, prepField: { ...priv.prepField, round: 13 } }).opts.side, 'L', 'ignore an earlier round assignment');
});
test('an unchanged shop state cannot mask a changed boss side', () => {
  const next = foldCamera({ pub, priv, myId: 'b', ownPrep: true, current: { kind: 'bossPrep', opts: { side: 'L', shop: true } } });
  assert.equal(next.opts.side, 'R');
  assert.equal(foldCamera({ pub, priv, myId: 'b', ownPrep: true, current: next }), null);
});

test('current server assignment does not depend on public boss-round metadata arriving first', () => {
  const delayed = { ...pub, bossRound: null, hiddenRound: null };
  assert.equal(prepCamera(delayed, 'b', priv).kind, 'bossPrep');
  assert.equal(deployFieldOf(delayed, 'b', priv), 'bossR');
  assert.equal(prepCamera({ ...delayed, round: 13 }, 'b', priv).kind, 'prep');
  assert.equal(prepCamera(delayed, 'other', priv).kind, 'prep');
  assert.equal(prepCamera(delayed, 'b', { ...priv, alive: false }).kind, 'prep');
});
