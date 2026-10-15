export const VERSUS_EGIR_PER_LAYER = 0.005;

export function versusBondRecord(record) {
  if (record?.bondId !== 'egirShip') return record;
  const extra = '不吞噬友方干员；每层额外增加【阿戈尔】干员0.5%的攻击力和生命值，随当前层数即时生效。每名在场【阿戈尔】干员每5秒增加1层，多名干员独立触发（按真实时间，倒地或撤回重置计时），上限200层。';
  const revive = '<在场5名不同【阿戈尔】干员>前3名【阿戈尔】干员首次被击倒时立刻复活';
  const desc = `【阿戈尔】干员生命值提升（保留原生命加成）\n${extra}\n${revive}`;
  const effect = `【阿戈尔】干员生命值+{0:0%}、攻击力+{1:0%}\n${extra}\n${revive}`;
  return { ...record, desc, descRaw: desc, effectDesc: effect, effectDescRaw: effect,
    bb: { ...record.bb, max_hp_per_stack: (record.bb.max_hp_per_stack || 0) + VERSUS_EGIR_PER_LAYER,
      versus_atk_per_stack: VERSUS_EGIR_PER_LAYER },
    effectDescParams: [...record.effectDescParams,
      { index: 1, format: '0%', base: null, perStack: 'versus_atk_per_stack' }] };
}
