// 克莱门莎 (char_4231_clemnt), 6★ 近卫, branch primguard.
// Sources: zh_CN character_table / skill_table (2026-10-08); official Android 2.7.81,
// res 26-10-08-04-51-28-56071834: charpack/char_4231_clemnt, [uc]skills / projectiles,
// buff_template_holder clemnt_* (see docs/CLEMENTIA-LOCAL-TEST.md for provenance and limits).
// Full potential; normal E2 Lv1 rank4, elite E2 Lv60 rank7. No module exists in this data.
// S2: box 1.1², speed 2, travel 3, obstacle probe 0.4; passengers ISOLATE, cumulative
// weight/count; vortex radius 1.5, lifetime 2, 1-second per-target damage cadence.
// S3: x-5 on the burst tile, hits at +1/+2/+3 seconds, 5-second same-tile exclusion.
// [ASSUMED] casts begin immediately (the engine's common convention); terrain obstruction
// uses this battle's field. Selection of simultaneous burst marks uses spawn order.
// The damage rider's explicit element_type=2 and official text select erosion (WATER);
// the generic node's unused default DARK is not the selected element.

import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { canTargetEnemy } from '../../../targeting.js';
import { hasHp } from '../../../damage.js';
import { bodyInKeys, hitRect } from '../../../body.js';
import { COLS } from '../../../constants.js';
import { toLocal } from '../../../dir.js';

const S1 = 'skchr_clemnt_1', S2 = 'skchr_clemnt_2', S3 = 'skchr_clemnt_3';
const GROUND = Object.freeze({ canHitFly: false });
const ANY = Object.freeze({ canHitFly: true });
const DISARM = 'clemnt:launch';
const state = (u) => u.mem.clemnt ?? (u.mem.clemnt = { capsule: null, zones: [], rockets: [], marks: new Map() });
const on = (u, id) => u.skill?.active && u.skill.id === id;
const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const crossKeys = (r, c) => [[r, c], [r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]].map(([y, x]) => y * COLS + x);
const passengerKey = (u) => `clemnt:passenger:${u.id}`;
const slowKey = (u) => `clemnt:vortex:${u.id}`;

/** Official capsule box; huge bodies intersect the box rather than testing only their centre. */
function touches(e, w) {
  const R = hitRect(e);
  return R ? R.x1 >= w.x - 0.55 && R.x0 <= w.x + 0.55 && R.y1 >= w.y - 0.55 && R.y0 <= w.y + 0.55
    : Math.abs(e.x - w.x) <= 0.55 && Math.abs(e.y - w.y) <= 0.55;
}

export default {
  char_4231_clemnt: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tag = chess.talents?.find((t) => t.index === 1)?.bbStr?.tag ?? 'seamonster';
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);

    function release(battle, unit, w) {
      for (const e of w.passengers) {
        battle.removeBuff(e, passengerKey(unit));
        if (e.alive && !e.removed) {
          battle._setHidden(e, false);
          e.atkStandUntil = -Infinity;
          if (e.route) e.route.pts = null;
        }
      }
      w.passengers.clear();
    }
    function endCapsule(battle, unit, vortex) {
      const m = state(unit), w = m.capsule;
      if (!w) return;
      release(battle, unit, w);
      m.capsule = null;
      battle.removeBuff(unit, DISARM);
      if (vortex) {
        m.zones.push({ x: w.x, y: w.y, left: 2, last: battle.time, timers: new Map() });
        battle.fx('clemntVortex', { x: w.x, y: w.y, radius: 1.5, dur: 2,
          id: unit.id, key: `clemnt:vortex:${unit.id}:${battle.time}` });
      }
    }
    function clean(battle, unit) {
      endCapsule(battle, unit, false);
      const m = state(unit);
      for (const e of battle.enemies) battle.removeBuff(e, slowKey(unit));
      m.zones = []; m.rockets = []; m.marks.clear();
    }
    function capture(battle, unit, w) {
      for (const e of battle.enemies) {
        if (w.seen.has(e) || !canTargetEnemy(unit, e, GROUND) || !touches(e, w)) continue;
        w.seen.add(e); // collision only once, including a passenger refused by the limits
        // Leaders are protected from displacement. Capsule transport writes positions directly,
        // so it must enforce that protection here, even when weightless brings mass below the cap.
        if (e.isBoss) continue;
        const mass = Math.max(0, e.s.massLevel);
        if (e.motion !== 'WALK' || e.s.flags.isolated || e.def.immune?.has('isolate') || e.def.immune?.has('isolated')) continue;
        if (w.count >= num(b2['attack@max_passenger_cnt']) || w.mass + mass > num(b2['attack@max_passenger_mass'])) continue;
        w.count++; w.mass += mass; w.passengers.add(e);
        battle.addBuff(e, { key: passengerKey(unit), source: unit, flags: { isolated: true, noMove: true, noSp: true }, tags: ['skill'] });
        battle._setHidden(e, true);
        e.x = w.x; e.y = w.y;
      }
    }
    function capsuleTick(battle, unit, dt) {
      const w = state(unit).capsule;
      if (!w) return;
      capture(battle, unit, w);
      const dist = Math.min(2 * dt, 3 - w.travel);
      // The 0.4-tile leading probe stops before an impassable / high tile.
      const r = Math.round(w.y + w.dr * (dist + 0.4)), c = Math.round(w.x + w.dc * (dist + 0.4));
      if (!battle.grid.groundPassable(r, c) || battle.grid.tile(r, c).height === 'HIGH') { endCapsule(battle, unit, true); return; }
      w.x += w.dc * dist; w.y += w.dr * dist; w.travel += dist;
      for (const e of w.passengers) { if (e.alive && !e.removed) { e.x = w.x; e.y = w.y; } }
      capture(battle, unit, w);
      if (w.travel >= 3 - 1e-9) endCapsule(battle, unit, true);
    }
    function zoneTick(battle, unit) {
      const m = state(unit);
      const slowed = new Set();
      for (const z of m.zones) {
        const passed = Math.max(0, battle.time - z.last);
        z.last = battle.time;
        const elapsed = Math.min(z.left, passed);
        const inside = new Set(battle.foesInRadius(z.x, z.y, 1.5).filter((e) => canTargetEnemy(unit, e, ANY)));
        for (const e of z.timers.keys()) if (!inside.has(e)) z.timers.delete(e);
        for (const e of inside) {
          slowed.add(e);
          let acc = (z.timers.get(e) ?? 0) + elapsed;
          while (acc >= 1 - 1e-9 && hasHp(e)) {
            acc -= 1;
            battle.dealDamage(unit, e, { amount: num(b2['attack@water_element']), type: 'element', element: 'erosion', isSkill: true, tags: ['skill', 'clemnt:vortex'] });
            battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(b2['attack@physical_atk_scale']), type: 'phys', isSkill: true, tags: ['skill', 'clemnt:vortex'] });
          }
          z.timers.set(e, acc);
        }
        z.left -= passed;
      }
      m.zones = m.zones.filter((z) => z.left > 1e-9);
      for (const e of battle.enemies) {
        if (slowed.has(e) && m.zones.length) battle.addBuff(e, { key: slowKey(unit), source: unit, mods: { moveMul: 1 + num(b2['attack@move_speed']) }, tags: ['skill'] });
        else battle.removeBuff(e, slowKey(unit));
      }
    }
    function rocketTick(battle, unit) {
      const m = state(unit), sk = unit.skill;
      for (const [e, expires] of m.marks) {
        if (expires < battle.time || !hasHp(e) || !canTargetEnemy(unit, e, GROUND)) { m.marks.delete(e); continue; }
        if (!on(unit, S3) || !unit.canAct || unit.s.flags.silence || !(sk.ammoLeft > 0)) continue;
        const r = Math.round(e.y), c = Math.round(e.x);
        if (m.rockets.some((q) => q.r === r && q.c === c)) continue;
        m.marks.delete(e);
        m.rockets.push({ r, c, born: battle.time, hits: 0 });
        sk.ammoLeft--;
        battle.emit('ammoUsed', { unit, left: sk.ammoLeft, skill: sk });
        if (sk.ammoLeft <= 0) sk.end('ammo');
      }
      for (const q of m.rockets) {
        while (q.hits < 3 && battle.time >= q.born + q.hits + 1 - 1e-9) {
          q.hits++;
          const keys = crossKeys(q.r, q.c);
          battle.fx('aoe', { x: q.c, y: q.r, radius: 1.5, id: unit.id, skill: 'clemnt:rocket' });
          for (const e of battle.enemies) if (canTargetEnemy(unit, e, GROUND) && bodyInKeys(e, keys)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(b3.s3_atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'clemnt:rocket'] });
            battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(b3.ep_damage_scale), type: 'elemental', isSkill: true, tags: ['skill', 'clemnt:rocket'] });
          }
        }
      }
      m.rockets = m.rockets.filter((q) => battle.time < q.born + num(b3.projectile_life_time, 5));
    }

    return {
      trait: {
        // S2's limited splash is authored here; the shared unrestricted splash would hit too many.
        hitsFn: (_battle, u, info) => info.isSkill && u.skill?.id === S2 ? 0 : 1,
        onEachHit(battle, unit, target, info) {
          if (!info.isSkill || unit.skill?.id !== S2 || info.kind !== 'main' || !target) return;
          const near = battle.foesInRadius(target.x, target.y, 1.1, true)
            .filter((e) => e !== target && canTargetEnemy(unit, e, GROUND));
          near.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) || a.spawnSeq - b.spawnSeq);
          for (const e of [target, ...near.slice(0, num(b2['attack@max_target']))]) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(b2['attack@aoe_atk_scale']), type: 'phys', isAttack: true, isSkill: true, attackId: info.attackId, tags: ['clemnt:s2'] });
          }
        },
      },
      skills: {
        [S1]: { kind: 'instant', attack: { atkScale: num(b1.atk_scale), tags: ['clemnt:s1'] } },
        [S2]: {
          kind: 'duration', mods: { aspd: num(b2.attack_speed) },
          targeting: { rangeGrid: skillRec(chess, S2)?.rangeGrid },
          onStart({ battle, unit }) {
            endCapsule(battle, unit, false);
            const [dr, dc] = unit.fwd;
            state(unit).capsule = { x: unit.x, y: unit.y, dr, dc, travel: 0, count: 0, mass: 0, passengers: new Set(), seen: new Set() };
            battle.addBuff(unit, { key: DISARM, duration: 10, flags: { disarm: true }, tags: ['skill'] });
            battle.fx('dash', { x: unit.x, y: unit.y, id: unit.id, skill: 'clemnt:capsule' });
          },
          onEnd({ battle, unit }) { clean(battle, unit); },
        },
        [S3]: {
          kind: 'ammo', ammo: num(b3.trigger_time),
          targeting: { rangeGrid: skillRec(chess, S3)?.rangeGrid, maxTargets: num(b3['attack@max_target']) },
          attack: { atkScale: num(b3['attack@atk_scale']), tags: ['clemnt:s3'] },
          onStart({ unit }) { state(unit).marks.clear(); },
          onEnd({ unit }) { state(unit).marks.clear(); },
          onAttack(ctx) { ctx.noAmmo = true; }, // only ShipLaunchedRocket consumes a round
        },
      },
      talents: [
        { install(battle, unit) {
          battle.on('hit', (c) => {
            if (c.source !== unit || c.dmg.type !== 'phys') return;
            const chance = c.target.s.def < c.target.base.def ? num(t0.prob_special) : num(t0.prob_normal);
            if (battle.rng.chance(chance)) c.dmg.amount *= num(t0.t1_atk_scale, 1);
          }, { owner: unit });
        } },
        { install(battle, unit) {
          battle.on('hit', (c) => {
            if (c.target !== unit || !c.source || !['phys', 'arts'].includes(c.dmg.type)) return;
            const front = toLocal(Math.round(c.source.y) - unit.tileR, Math.round(c.source.x) - unit.tileC, unit.dir)[1] >= 0;
            if (front || c.source.blockedBy === unit) c.dmg.mul *= 1 - num(c.source.tags.has(tag) ? t1.damage_resistance_seamonster : t1.damage_resistance_normal);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        battle.on('damaged', (c) => {
          if (c.source !== unit || c.type !== 'phys' || !c.dmg.isAttack || !c.dmg.isSkill || !hasHp(c.target)) return;
          const ratio = unit.skill?.id === S1 ? num(b1.ep_damage_ratio) : unit.skill?.id === S3 ? num(b3['attack@ep_damage_ratio']) : 0;
          if (ratio > 0) battle.dealDamage(unit, c.target, { amount: c.amount * ratio, type: 'element', element: 'erosion', isSkill: true, tags: ['skill', 'clemnt:rider'] });
        }, { owner: unit });
        battle.on('elementBurst', (c) => {
          if (!on(unit, S3) || c.element !== 'erosion' || c.target?.side !== 'enemy') return;
          state(unit).marks.set(c.target, battle.time + num(b3.ep_break_duration, 1));
          // A burst may come from anyone, including an enemy beyond the operator's attack range.
        }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          if (!up(unit)) { clean(battle, unit); return; }
          capsuleTick(battle, unit, dt);
          zoneTick(battle, unit);
          rocketTick(battle, unit);
        }, { owner: unit });
        battle.on('death', (c) => { if (c.unit === unit) clean(battle, unit); }, { owner: unit });
        battle.on('deploy', (c) => { if (c.unit === unit) clean(battle, unit); }, { owner: unit });
      },
    };
  },
};
