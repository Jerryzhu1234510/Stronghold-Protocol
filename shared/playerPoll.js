export const CLEMENTIA_POLL = Object.freeze({
  id: 'clemnt-adjustment-preview-20261010',
  title: '克莱门莎调整',
  options: Object.freeze([
    Object.freeze({ id: 'tier4', title: '四本', bonds: ['阿戈尔', '不屈', '灵巧'],
      description: '获得时，给予一个阿戈尔重刃；精锐时给予精锐的重刃。' }),
    Object.freeze({ id: 'tier5', title: '五本', bonds: ['阿戈尔', '迅捷', '不屈'],
      description: '全体友方总计击杀3个敌人，所属盟约各叠加1层；精锐时每击杀2个敌人叠加1层。' }),
    Object.freeze({ id: 'tier6', title: '六本', bonds: ['阿戈尔', '不屈', '突袭'],
      description: '核心盟约每叠加1层，给予1%攻击力与攻速加成；精锐为2%。' }),
    Object.freeze({ id: 'unchanged', title: '不该', bonds: [],
      description: '维持当前版本，不作调整。' }),
  ]),
});

export const validPollChoice = choice => CLEMENTIA_POLL.options.some(option => option.id === choice);

/** Preview-only tally: the screenshot's old votes are not real votes in this poll. */
export function previewPollResults(choice) {
  const total = validPollChoice(choice) ? 1 : 0;
  return { total, options: CLEMENTIA_POLL.options.map(option => ({
    id: option.id, votes: total && option.id === choice ? 1 : 0,
    percent: total && option.id === choice ? 100 : 0,
  })) };
}
