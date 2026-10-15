import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const char = 'char_4217_makoto';
const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url)));
const model = manifest.chars[char].spine;
let fake, UnitView;
before(async () => { fake = installFakePixi(); ({ UnitView } = await import('../../public/js/render/units.js')); });
after(() => fake.restore());
const tick = () => new Promise(resolve => setImmediate(resolve));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const frames = (v, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) v.update(1 / 60, cam(), t); };
async function view(skillIndex, form = null, dir = 'RIGHT') {
  const assets = { hasBack: () => true, picture: () => null, image: async () => null,
    spineEntry: (_, { back } = {}) => back ? model.back : model.front,
    spine: { acquire: async entry => ({ animations: Object.keys(entry.animations).map(name => ({ name })) }), release() {} } };
  const v = new UnitView(fakeViewCtx(fake.P, { assets, cam }), { id: 7, side: 'ally', kind: 'op',
    defId: char, spine: char, tier: 5, x: 4, y: 10, maxHp: 2000, skillIndex, form, dir });
  await tick(); await tick();
  return v;
}
const idle = ['Doll_Skill_1_Idle', 'Doll_Skill_2_Loop', 'Doll_Skill_3_P1_Idle'];
const attack = ['Doll_Skill_1_Attack', 'Doll_Skill_2_Loop', 'Doll_Skill_3_P1_Attack_A'];

test('Persona is not cropped to the cached body silhouette as it appears and grows', async () => {
  const v = await view(2);
  let bounds = { x: -50, y: -100, width: 100, height: 100 };
  v.actor.spine.getLocalBounds = () => bounds;
  const body = v._impBox();
  v.actor.clipped = true;
  v.setForm('doll');
  frames(v, .1);
  assert.equal(v.actor.clipOn, false, 'body clipping must not hide the Persona');
  bounds = { x: -200, y: -400, width: 500, height: 400 };
  const persona = v._impBox();
  assert.ok(persona.w > body.w && persona.h > body.h);
  bounds = { x: -250, y: -500, width: 600, height: 500 };
  assert.ok(v._impBox().h > persona.h, 'switching animation can continue growing after the first frame');
  v.setForm('makotoOrpheus');
  assert.ok(v._impBox().w >= 600);
  v.setForm(null);
  frames(v, .1);
  assert.equal(v.actor.clipOn, false, 'the closing persona still needs to draw without the body clipping');
  frames(v, 1.1);
  assert.equal(v.actor.clipOn, true, 'body clipping resumes on return');
  bounds = { x: -50, y: -100, width: 100, height: 100 };
  assert.deepEqual(v._impBox(), body, 'returning to the body restores its small cached box');
  v.destroy();
});

for (const si of [0, 1, 2]) test(`Makoto S${si + 1} UP returns through its front closing animation before restoring the Back body`, async () => {
  const v = await view(si, 'doll', 'UP');
  assert.equal(v.entryBack, true);
  v.setForm(null); frames(v, .1); await tick(); await tick();
  assert.equal(v.entryBack, false, 'Back has no closing animation: load the existing Front skeleton');
  assert.equal(v.actor.current, `Doll_Skill_${si + 1}${si === 2 ? '_P1' : ''}_SwitchOut`);
  v.actor.clipped = true;
  frames(v, .1);
  assert.equal(v.actor.clipOn, false);
  frames(v, 1.1); await tick(); await tick();
  assert.equal(v.entryBack, true);
  assert.equal(v.actor.current, 'Idle');
  v.destroy();
});

for (const si of [0, 1, 2]) for (const dir of ['RIGHT', 'UP']) test(`Makoto S${si + 1} ${dir} draws its equipped persona and attack rather than the body`, async () => {
  const v = await view(si, 'doll', dir);
  v.actor.setBase('idle');
  assert.equal(v.actor.current, idle[si]);
  v.onAttack(null, 1);
  assert.equal(v.actor.current, attack[si]);
  v.destroy();
});

for (const si of [0, 1, 2]) test(`Makoto S${si + 1} plays switching in and out with the correct persona`, async () => {
  const v = await view(si);
  v.setForm('doll');
  assert.equal(v.actor.current, `Doll_Skill_${si + 1}${si === 2 ? '_P1' : ''}_SwitchIn`);
  frames(v, 1.1);
  assert.equal(v.actor.current, idle[si]);
  v.setForm(null);
  assert.equal(v.actor.current, `Doll_Skill_${si + 1}${si === 2 ? '_P1' : ''}_SwitchOut`);
  frames(v, 1.1);
  assert.equal(v.actor.current, 'Idle');
  v.destroy();
});

test('S3 Orpheus plays both change clips, an instant skill ending does not interrupt, and it returns to the body', async () => {
  const v = await view(2, 'doll');
  v.setSkill(true);
  v.setForm('makotoOrpheus', { dur: 1.5 });
  v.setSkill(false);
  assert.equal(v.actor.current, 'Doll_Skill_3_P1toP2_ChangeBegin');
  frames(v, 0.6);
  assert.equal(v.actor.current, 'Doll_Skill_3_P1toP2_ChangeEnd');
  frames(v, 1.1);
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_Loop');
  v.setForm(null);
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_SwitchOut');
  frames(v, 1.1);
  assert.equal(v.actor.current, 'Idle');
  v.destroy();
});

test('S3 Orpheus facing UP uses the front model because the back skeleton has no Orpheus clips', async () => {
  const v = await view(2, 'makotoOrpheus', 'UP');
  assert.equal(v.entryBack, false);
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_Loop');
  v.die();
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_Die');
  v.destroy();
});

test('S3 switches an already loaded UP-facing Thanatos model to the Orpheus model and restores Back on return', async () => {
  const v = await view(2, 'doll', 'UP');
  assert.equal(v.entryBack, true);
  v.setForm('makotoOrpheus', { dur: 1.5 });
  frames(v, 0.1); await tick(); await tick();
  assert.equal(v.entryBack, false);
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_Loop');
  v.setForm(null); frames(v, 0.1); await tick(); await tick();
  assert.equal(v.entryBack, false, 'finish the front-only Orpheus return animation before restoring Back');
  assert.equal(v.actor.current, 'Doll_Skill_3_P2_SwitchOut');
  frames(v, 1.1); await tick(); await tick();
  assert.equal(v.entryBack, true);
  assert.equal(v.actor.current, 'Idle');
  v.destroy();
});
