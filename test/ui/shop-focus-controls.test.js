import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { net } from '../../public/js/net.js';
import { actions } from '../../public/js/ui/gameActions.js';
import { hudBands } from '../../public/js/ui/fieldHost.js';

test('the real screen action submits both a bond choice and clearing it through net.request', async () => {
  const original = net.request, sent = [];
  net.request = async (type, fields) => { sent.push({ t:type, ...fields }); return { ok:true }; };
  try {
    assert.equal(await actions.shopFocus('yanShip'), true);
    assert.equal(await actions.shopFocus(null), true);
  } finally { net.request = original; }
  assert.deepEqual(sent, [{ t:'g.shopFocus', bondId:'yanShip' }, { t:'g.shopFocus', bondId:null }]);
});

test('all screen action references resolve to callable actions, including the shop-focus select', () => {
  const screen = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  for (const [, name] of screen.matchAll(/\bactions\.([a-zA-Z]\w*)\s*\(/g)) {
    assert.equal(typeof actions[name], 'function', `missing UI action: ${name}`);
  }
});

test('phone camera reserves the measured shop dock including its controls; desktop keeps the original band', () => {
  const oldDoc = globalThis.document, oldStyle = globalThis.getComputedStyle;
  globalThis.document = {
    documentElement: {},
    querySelector: selector => ({ getBoundingClientRect: () => selector === '.shopbar'
      ? {top:204,height:148} : {top:0,bottom:360} }),
  };
  globalThis.getComputedStyle = () => ({fontSize:'40px'});
  try {
    assert.equal(hudBands('prep', {width:844,height:360}).bottom, 156);
    // A viewport transition/animation can report the dock at a stale Y while its height is already correct.
    globalThis.document.querySelector = selector => ({ getBoundingClientRect: () => selector === '.shopbar'
      ? {top:40,height:148} : {top:0,bottom:360} });
    assert.equal(hudBands('prep', {width:844,height:360}).bottom, 156, 'camera must not shrink from a transient shop Y');
    assert.ok(Math.abs(hudBands('prep', {width:1440,height:900}).bottom - 108.6) < .0001);
    assert.equal(hudBands('normal', {width:844,height:360}), null);
  } finally {
    if (oldDoc === undefined) delete globalThis.document; else globalThis.document = oldDoc;
    if (oldStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = oldStyle;
  }
});
