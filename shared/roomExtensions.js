import { N_ } from './i18n.js';
// Declarative built-in pre-match settings. Adding a rule requires a normal
// matching server/client release. Player Mods remain local cosmetic/audio only.
export function createExtensionRegistry(definitions = []) {
  const entries = new Map();
  const register = definition => {
    const d = { ...definition };
    if (!/^[a-z][A-Za-z0-9_.-]{0,63}$/.test(d.id) || entries.has(d.id)
      || !['number', 'boolean'].includes(d.type) || typeof d.label !== 'string') throw new Error('Invalid extension definition');
    if (d.type === 'number' && !(Number.isFinite(d.min) && Number.isFinite(d.max) && d.min <= d.default && d.default <= d.max)) throw new Error('Invalid numeric extension');
    if (d.type === 'boolean' && typeof d.default !== 'boolean') throw new Error('Invalid boolean extension');
    entries.set(d.id, Object.freeze(d));
  };
  definitions.forEach(register);
  // The first local release used a checkbox for Ducklord: false/true still
  // mean off/tier 1 when an older client submits that setting.
  const canonicalValue = (d, v) => d.legacyBoolean && typeof v === 'boolean' ? Number(v) : v;
  const validValue = (d, value) => {
    const v = canonicalValue(d, value);
    return d.type === 'boolean' ? typeof v === 'boolean' : Number.isInteger(v) && v >= d.min && v <= d.max;
  };
  return {
    register,
    catalog: () => [...entries.values()].map(d => ({ ...d })),
    defaults: () => Object.fromEntries([...entries].map(([id, d]) => [id, d.default])),
    validate(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).every(([id, v]) => entries.has(id) && validValue(entries.get(id), v));
    },
    normalize(value) {
      if (value != null && !this.validate(value)) throw new Error('Invalid room extensions');
      return Object.freeze({ ...this.defaults(), ...Object.fromEntries(Object.entries(value || {})
        .map(([id, v]) => [id, canonicalValue(entries.get(id), v)])) });
    },
  };
}

export const roomExtensions = createExtensionRegistry([
  { id: 'personalPool', type: 'boolean', default: false, label: N_('个人卡池'),
    description: N_('每位玩家（含AI）独立使用一份完整干员卡池，购买、奖励、出售和淘汰回收均只影响本人。保留卡池数量、禁用盟约、抽取权重与自选库存规则，并非无限卡池。开启后按自定义局计杯。') },
  { id: 'bossHp', type: 'number', default: 1, min: 1, max: 96, affectsTrophies: false, label: N_('Boss 血量倍率'),
    description: N_('额外乘在原版难度、人数和克隆倍率上。包括鸭爵召出的领袖；共享血池只乘一次。正常模式仅提高血量不降低杯数。') },
  { id: 'enemyHp', type: 'number', default: 1, min: 1, max: 96, affectsTrophies: false, label: N_('其他敌人血量倍率'),
    description: N_('非领袖敌人及其召唤物按自身分类加成。仅改变生命，不改变攻击、防御与出怪量。正常模式仅提高血量不降低杯数。') },
  { id: 'bossNoDamageLimit', type: 'boolean', default: false, label: N_('取消 Boss 限伤'),
    description: N_('关闭 Boss／隐秘核心战中“单次最终伤害达到30万则整次无效”的规则。保留无敌、护盾、阶段转换与受击次数机制；普通战与联防原本不受该限伤。') },
  { id: 'duckEnhanced', type: 'number', default: 0, min: 0, max: 2, legacyBoolean: true, label: N_('鸭爵策略加强'),
    options: [{ value: 0, label: N_('关闭（原版）') }, { value: 1, label: N_('一档') }, { value: 2, label: N_('二档（墓碑／双骑士）') }],
    description: N_('均保留原效果。第11回合起每人每回合60%概率触发。一档：复仇者6金、巨大的丑东西5金、自在4金、杰斯顿4金，等概率单只。二档替换强敌池：墓碑或凋零＋腐败骑士双人组，等概率；每只生命×2；墓碑击杀5金，双骑士各3金。仍叠加难度、人数与Boss血量倍率；联防沿用原赏金归属。') },
]);

// Envelope limits leave space for future built-in options. Semantic validation
// uses the registry in Lobby, never silently drops unknown keys.
export function extensionEnvelope(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 32
    && Object.entries(v).every(([k, x]) => /^[a-z][A-Za-z0-9_.-]{0,63}$/.test(k)
      && (typeof x === 'boolean' || (Number.isFinite(x) && Math.abs(x) <= 1e6)));
}
