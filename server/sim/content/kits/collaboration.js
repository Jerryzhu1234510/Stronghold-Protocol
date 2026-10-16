// Six-star supports. Numeric effects use the selected Lv4/Lv7 client blackboards.
// Manual placements/movement are automated for this autobattler; see docs/SUPPORTS.md.
// Effects are procedural markers; no independent original particle/video payload is downloaded.
import { COLS } from '../../constants.js';
import { hypot } from '../../detmath.js';
import { sortEnemyTargets, absoluteRangeKeys } from '../../targeting.js';
import { rotateOffset } from '../../dir.js';
import { summonToken, tacticalPoint } from '../tokens.js';
import { weaknessRetype, addShieldLayer } from '../items/battle.js';
import { batMod } from './shared/tier1.js';
import { normalizeSkill } from '../../simdata.js';

const live = u => !!u?.alive && u.deployed && !u.hidden && !u.removed;
const talent = (def, i) => def.talents?.[i]?.bb || {};
const key = u => Math.round(u.y) * COLS + Math.round(u.x);
const foes = (b, u) => sortEnemyTargets(b, u, b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }));
const allies = (b, u) => b.alliesFor(u).filter(live);
const nearAllies = (b, u) => allies(b, u).filter(a => u.rangeKeySet.has(key(a)));
const bursting = e => !!e.findBuff('neuralBurst');
const hit = (b, u, e, scale, type = 'arts', tag = 'supportSkill', extra = {}) => b.dealDamage(u, e, { amount: u.s.atk * scale, type, isSkill: true, tags: [tag], ...extra });
const neural = (b, u, e, amount) => b.dealDamage(u, e, { amount, type: 'element', element: 'neural', isSkill: true });
const fx = (b, u, motif, point = u, radius = 1) => b.fx('supportEffect', { id: u.id, x: point.x, y: point.y, radius, motif });
const skillRange = def => def.skill.rangeGrid ? { rangeGrid: def.skill.rangeGrid } : {};
const castRange = def => def.skill.rangeGrid ? { rule: 'SKILL_RANGE', grid: def.skill.rangeGrid } : 'DEFAULT';
function every(b, u, period, fn) {
  let acc = 0;
  b.on('tick', ({ dt }) => { if (!live(u)) return; acc += dt; if (acc + 1e-9 < period) return; const elapsed = acc; acc %= period; fn(elapsed); }, { owner: u });
}
function onHit(b, u, fn) { b.on('hit', ctx => { if (ctx.source === u && ctx.target?.side === 'enemy' && ctx.dmg.isAttack) fn(ctx); }, { owner: u }); }
function onAttack(b, u, fn) { b.on('attack', ctx => { if (ctx.attacker === u) fn(ctx); }, { owner: u }); }
function sakiko(bb, chess, def) {
  const si = chess.skill.index, t0 = talent(def, 0), t1 = talent(def, 1);
  const scales = Object.keys(bb).filter(k => /^atk_scale(?:_\d+)?$/.test(k)).map(k => bb[k]);
  const note = (b, u, e, scale, type, isAttack = false) => b.addProjectile({ from: u, target: e, source: u, visual: 'bolt',
    speed: type === 'phys' ? 5 : 2, maxAge: 15, data: { supportNote: true },
    onHit({ target }) { if (target && live(u)) hit(b, u, target, scale, type, 'sakikoNotes', { isAttack }); },
  });
  return {
    skill: si === 0 ? { kind: 'instant', onStart({ battle, unit }) {
      const e = foes(battle, unit)[0]; if (!e) return;
      scales.forEach((scale, i) => battle.after(i * 0.08, () => { if (live(unit) && live(e)) note(battle, unit, e, scale, 'arts'); }, { owner: unit })); fx(battle, unit, 'music');
    } } : si === 1 ? { kind: 'instant', onStart({ battle, unit }) {
      unit.mem.sakikoOrgan = !unit.mem.sakikoOrgan;
      battle.addBuff(unit, { key: 'sakiko:instrument', mods: unit.mem.sakikoOrgan ? { aspd: bb['attack@attack_speed'] } : { atkPct: bb['attack@atk'] } });
      unit.profile = { ...unit.profile, dmgType: unit.mem.sakikoOrgan ? 'arts' : 'phys', projectile: 'bolt' }; fx(battle, unit, 'music');
    } } : { kind: 'duration', targeting: skillRange(def), trigger: castRange(def), attack: { noAttack: true },
      onStart({ unit, battle }) { unit.mem.sakikoAcc = unit.s.interval; fx(battle, unit, 'music', unit, 2); },
      onTick({ battle, unit, dt }) {
        if (!unit.canAct) return; unit.mem.sakikoAcc += dt; if (unit.mem.sakikoAcc < unit.s.interval) return; unit.mem.sakikoAcc %= unit.s.interval;
        const targets = foes(battle, unit); if (!targets.length) return;
        for (const type of ['phys', 'arts']) for (const e of targets.slice().sort((a, c) => (type === 'phys' ? c.s.res - a.s.res : c.s.def - a.s.def)).slice(0, 2)) note(battle, unit, e, bb['attack@atk_scale'], type, true);
        battle._ev(['atk', unit.id, targets[0].id, 'bolt']);
        unit.lastAttackAt = battle.time;
        unit.stats.attacks++; unit.skill.onAttackPerformed(targets, true);
      },
    },
    install(b, u) {
      // Continuous notes are attacks even without an enemy, and recover attack SP.
      u.profile = { ...u.profile, emptyAttack(battle, unit) {
        const [dr, dc] = rotateOffset(0, 8, unit.dir);
        const type = unit.profile.dmgType || 'phys';
        battle.addProjectile({ from: unit, to: { x: unit.x + dc, y: unit.y + dr }, source: unit,
          visual: 'bolt', speed: type === 'phys' ? 5 : 2, maxAge: 15, data: { supportNote: true, idleNote: true },
          onHit({ target }) { if (target && live(unit)) hit(battle, unit, target, 1, type, 'sakikoNotes', { isAttack: true, isSkill: false }); },
        });
      } };
      const mujica = () => allies(b, u).filter(a => a.def.raw?.teamId === 'mujica');
      // gamedata_const ba.fever: 450 points, a member's MANUAL cast starts 20 seconds of Fever.
      const state = b._supportMujica ||= { points: 0, until: 0 };
      if (!state.installed) {
        state.installed = true;
        b.on('damaged', ({ source, amount, type }) => { if (amount > 0 && type !== 'element' && source?.def?.raw?.teamId === 'mujica' && b.time >= state.until) state.points = Math.min(450, state.points + t1.cnt); });
        b.on('skillStart', ({ unit }) => {
          if (state.points < 450 || !unit.skill.manual || unit.def.raw?.teamId !== 'mujica') return;
          state.points = 0; state.until = b.time + 20;
          for (const member of mujica()) { if (member.skill.active && member.skill.kind === 'duration') member.skill.timeLeft = Math.max(20, member.skill.timeLeft); fx(b, member, 'music'); }
          b.after(20, () => { for (const member of mujica().filter(a => a.mem.sakikoWithdraw)) { member.mem.sakikoWithdraw = false; b.retreat(member, { reason: 'expired', permanent: true }); } });
        });
      }
      u.mem.sakikoFever = state;
      if (si === 1) { u.mem.sakikoOrgan = false; b.addBuff(u, { key: 'sakiko:instrument', mods: { atkPct: bb['attack@atk'] } }); }
      onAttack(b, u, ({ targets }) => {
        const e = targets.find(e => e.side === 'enemy'); if (!e || si === 0 && u.skill.pending) return;
        if (si === 1 && b.time < state.until) note(b, u, e, 1, u.profile.dmgType, true);
      });
      every(b, u, 0.2, () => {
        let count = 0;
        for (const p of b.projectiles.list.filter(p => p.source === u)) {
          if (p.data?.idleNote && !p.target) {
            const target = foes(b, u)[0];
            if (target) { p.target = target; p.tseq = target.deploySeq; }
          }
          if (!u.rangeKeySet.has(key(p))) { p.data ||= {}; p.data.outsideAt ??= b.time; if (b.time - p.data.outsideAt >= t0.delay) { p.onHit = null; p.maxAge = p.age; } } else if (p.data) delete p.data.outsideAt;
          count++;
        }
        for (const a of mujica()) b.addBuff(a, { key: `sakiko:notes:${u.id}`, duration: 0.3, mods: { defIgnorePct: t0.def_penetrate_ratio * Math.min(count, t0.max_cnt), resIgnorePct: t0.magic_resist_penetrate_ratio * Math.min(count, t0.max_cnt) } });
        b._refreshRange(u); const original = new Set(u.baseRangeKeys), extended = new Set(u.rangeKeys);
        for (const a of mujica().filter(a => a !== u)) if (a.baseRangeKeys.some(k => original.has(k))) for (const k of a.baseRangeKeys) extended.add(k);
        u.rangeKeys = [...extended]; u.rangeKeySet = extended;
        for (const a of nearAllies(b, u)) b.addBuff(a, { key: 'sakiko:teamAspd', duration: 0.3, mods: { aspd: t1.attack_speed } });
        if (b.time < state.until && !u.skill.active) u.skill.charges = Math.max(1, u.skill.charges);
      });
      b.on('fatal', ctx => { if (si === 2 && u.skill.active && b.time < state.until && mujica().includes(ctx.unit)) { ctx.prevented = true; ctx.unit.mem.sakikoWithdraw = true; } }, { owner: u, priority: 10 });
    },
  };
}


function makoto(bb, chess, def) {
  const si = chess.skill.index, t0 = talent(def, 0), t1 = talent(def, 1);
  const orpheus = (b, u) => {
    if (u.mem.makotoOrpheus) return;
    u.mem.makotoOrpheus = true;
    u.form = 'makotoOrpheus';
    const subst = u.findBuff('trait:substitute'); if (subst) { subst.mods.blockCnt = 0; u.markDirty(); }
    const form = u.findBuff('makoto:form'); if (form) { form.mods.aspd = 0; u.markDirty(); }
    b.addBuff(u, { key: 'makoto:block', mods: { blockCnt: bb['attack@block_cnt'] - u.base.blockCnt } });
    u.profile = { ...u.profile, noAttack: true };
    b.fx('supportEffect', { id: u.id, x: u.x, y: u.y, radius: 2, motif: 'persona', form: u.form, dur: 1.5 });
  };
  return {
    skill: { kind: 'instant', onStart({ battle, unit }) {
      // In this autobattler the output persona stays until fatal damage; never spend another cast on phase two.
      if (unit.trait.doll) return;
      battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
    } },
    install(b, u) {
      const baseProfile = { ...u.profile };
      const baseRange = u.rangeGrid;
      const resetBody = () => {
        u.mem.makotoOrpheus = false;
        b.removeBuff(u, 'makoto:form'); b.removeBuff(u, 'makoto:block');
        u.profile = { ...baseProfile }; u.rangeGrid = baseRange; b.refreshRange(u);
      };
      b.on('dollSwap', ({ unit, form }) => {
        if (unit !== u) return;
        u.mem.makotoOrpheus = false;
        if (form === 'doll') {
          b.addBuff(u, { key: 'makoto:form', mods: { atkPct: t0.atk, hpPct: t0.max_hp_t1, batPct: batMod(t0.base_attack_time, chess), aspd: si === 2 ? bb['talent@attack_speed'] : 0 } });
          // Keep the trait's SP lock. Also block automatic casts from a charge carried into a fatal substitution.
          const subst = u.findBuff('trait:substitute'); if (subst && si === 2) { subst.flags.silence = true; u.markDirty(); }
          u.profile = { ...baseProfile, dmgType: 'arts', atkScale: bb['attack@atk_scale'], maxTargets: bb['attack@max_target'] || 1 };
          u.rangeGrid = chess.skill.rangeGrid || baseRange; b.refreshRange(u);
          for (const e of foes(b, u)) b.applyStatus(e, 'sluggish', { duration: t0.sluggish, source: u });
          fx(b, u, 'persona');
        } else {
          resetBody();
          const squad = allies(b, u).filter(a => a.def.raw?.teamId === 'sees' && hypot(a.x - u.x, a.y - u.y) < 2);
          for (const a of squad) for (const e of foes(b, a)) b.dealDamage(a, e, { amount: a.s.atk * t1.atk_scale, type: 'true', isSkill: true, tags: ['makotoAllOut'] });
        }
      }, { owner: u });
      b.on('death', ({ unit }) => { if (unit === u) resetBody(); }, { owner: u });
      onHit(b, u, ({ target, dmg }) => {
        if (!u.trait.doll) return;
        if (si === 2) weaknessRetype(dmg, u, target);
        if (si === 1 && b.rng() < bb['attack@prob']) b.applyStatus(target, 'fear', { duration: bb['attack@fear'], source: u });
        if (si === 1 && target.findBuff('fear') && target.hp < u.s.atk * bb['attack@kill_atk_scale']) hit(b, u, target, 0, 'true', 'makotoExecute', { amount: bb['attack@kill_damage'] });
      });
      b.on('beforeAttack', ctx => { if (ctx.attacker !== u || !u.trait.doll || si !== 0) return;
        const a = b.injuredAlliesInKeys(u.rangeKeys, u).find(a => a.hpRatio < 0.5);
        if (a) { b.heal(u, a, u.s.atk * bb['attack@heal_scale']); ctx.targets = []; u.atkCd = u.s.interval; }
      }, { owner: u });
      b.on('fatal', ctx => { if (ctx.unit === u && u.trait.doll && !u.trait.dollSwitching && si === 2 && !u.mem.makotoOrpheus && !ctx.prevented) { ctx.prevented = true; orpheus(b, u); u.hp = u.s.maxHp; } }, { owner: u, priority: 5 });
      every(b, u, 1, () => { if (si !== 2 || !u.mem.makotoOrpheus) return;
        for (const a of nearAllies(b, u)) b.addBuff(a, { key: 'makoto:dodge', duration: 1.1, mods: { dodgePhys: bb['attack@prob'], dodgeArts: bb['attack@prob'] } });
        for (const a of b.injuredAlliesInKeys(u.rangeKeys, u).slice(0, bb['attack@max_target_heal'])) b.heal(u, a, u.s.atk * bb['attack@heal_scale']);
      });
    },
  };
}


const selectedKit = fn => (bb, raw, def) => {
  const kit = fn(bb, raw, def);
  const skills = Object.fromEntries((raw.skills || [raw.skill]).filter(Boolean).map(s => {
    const selected = { ...raw, skill: s };
    const normalized = normalizeSkill(selected);
    return [normalized.id, fn(normalized.bb, selected, { ...def, skill: normalized }).skill];
  }));
  return { ...kit, skills };
};
export default { char_4182_oblvns: selectedKit(sakiko), char_4217_makoto: selectedKit(makoto) };
