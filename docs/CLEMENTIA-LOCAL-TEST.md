# 克莱门莎接入与本地测试（2026-10-09）

## 2026-10-10 投票结果调整（本地待发布）

本次采用五本方案：阿戈尔／迅捷／不屈，普通每3个友方累计击杀叠1层，精锐每2个叠1层。售价4，库存份数按五本；阿戈尔吞噬本数收益同步变为5。技能、天赋、形态数值与联防限制保持原实现。旧 `chess_char_4_27_a/b` ID 保留，避免破坏已保存配装和素材映射。

`tools/configure-clementia.mjs` 同步普通／精锐记录、盟约成员、自选归属与定制覆盖，且清除旧突袭成员关系。下文四本描述为历史记录，不再代表本次待发布规则。此次按用户要求只本地修改，尚未上传服务器。

克莱门莎已接入本地自选编队，角色 ID 为 `char_4231_clemnt`。三个技能、两个天赋、普通与精英形态、头像／立绘／技能图标和正背面动画已验证。公告已写入本地 `public/js/ui/releaseNotes.js`。

2026-10-09 已发布独立 r17：`e7e0ee91198d-8`，新增13个素材同步到 R2（2,324,306字节），复用12,713个已有对象。经用户明确确认退役无在线对局的 r14，r15／r16 的进程及在线对局保留。线上普通与精锐记录、三羁绊及特质均验证一致；正背面三个技能共六种动画实际从 R2 下载渲染，13个腾讯备用资源大小与哈希均正确。发布记录见工作区 `outputs/clementia-deploy/deployment.json`、`live-browser.json`。

公告后续补丁：克莱门莎的两条公告及标题使用红色高亮，正文增加红色背景卡片与左边框。发布过程中发现快速首页 importmap 仍将公告指向旧 `releaseNotes-free-20261009.js` 副本；已为 r17 改为经版本路径固定的 `releaseNotes-clemnt-20261009.js`，保证实际页面显示本次角色公告。仅更新 Caddy 静态公告路径及 `loading-r17/index.html`，所有游戏 worker PID 保持不变。新样式为 `public/css/release-notes-highlight-20261009.css`，已纳入本地首页供后续打包。后续发布须检查首页 importmap 中的公告模块与当前 `releaseNotes.js` 一致，不能沿用过期副本。记录及电脑版／横屏手机版截图在 `outputs/clementia-deploy/announcement-red/`。

## 四本与自定义特质（后续调整）

按用户要求，四本常规商店增加 `chess_char_4_27_a`／`chess_char_4_27_b`，价格和卡池份数沿用四本规则，三张普通棋子合成精锐。归属阿戈尔阵营，携带【阿戈尔】【不屈】【突袭】，三个盟约的成员名单均已更新。默认二技能，三个技能都可以选择；保留先前自选入口并同步这三个羁绊。

四本棋子的普通特质为：克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败4个敌人，使克莱门莎所属的【阿戈尔】【不屈】【突袭】中**已激活**的盟约各+1层；精锐阈值为3个敌人。此特质不授予其他干员，不增加其他干员所属盟约的层数。召唤物及同一战场的友方单位击败均计入。本人未部署、离场或隐藏期间不计数；友方被击败、敌方击败、无击败者的死亡不计数；每场战斗重置计数。联防显式禁用，同时遵循引擎已有的全局叠层开关（最终首领战原本关闭叠层）。

新增棋子、特质、盟约名单及自选归属写入 `data/custom-overlay.json`，数据重建后不会丢失。`tools/configure-clementia.mjs` 可重复生成这些定制记录。四本调用现有三个技能实现，特质经统一的 `gainLayers` 入口处理。

后续专项测试见 `test/content/clemnt-roster.test.js` 和 `test/match/clemnt-roster.test.js`：验证本数、商店卡池、购买与精锐合成、六种技能形态、三个盟约的8种激活组合、全体友方共用计数、召唤物、离场、联防及战斗间重置。最终相关战斗、卡池、合成、配装、自选和UI回归 **138项全部通过**；棋子／盟约／特质数据完整性 **8项全部通过**，合计146项。增加常规角色后的期望可见卡池数量更新为113，普通与精锐总记录数量为268。重复执行配置工具及定制覆盖均不改变结果，除新增记录和成员名单外，既有棋子、盟约与特质数据保持一致。

后续证据为 `outputs/clementia-upstream/test-clemnt-four-tier-final.txt` 和 `test-clemnt-data-integrity.txt`。

## 阿戈尔吞噬补测

新增 `test/content/clemnt-egir.test.js` 使用真实普通／精锐记录分别验证正常战斗与联防：克莱门莎吞噬前方干员获得基础攻击及阻挡数；被吞噬时按四本增加阿戈尔层数、继续向前延伸吞噬链；五人阿戈尔被吞噬后复活一次且保留二技能；吞噬友军不进入击杀敌人的特质计数。联防保留吞噬属性收益及复活，所有盟约加层保持禁用。与既有阿戈尔及联防回归一起 **38项全部通过**，证据为 `outputs/clementia-deploy/egir-tests.txt`。

## 来源

- 原项目战斗实现：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)。本次检查的上游技能注册表尚无克莱门莎；新增的 JavaScript 战斗逻辑由本项目根据数据实现，不是从官方客户端取得的 JavaScript。
- 角色数值、技能黑板和攻击范围：[Kengxxiao/ArknightsGameData zh_CN](https://github.com/Kengxxiao/ArknightsGameData/tree/master/zh_CN/gamedata)。使用项目现有 `build-data.mjs` 生成，沿用普通 E2 Lv1／技能4级、精英 E2 Lv60／技能7级和满潜规则。合并后，自选六星从73位增加至74位。保留了两位定制联动角色。
- 动画：[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource/tree/main/spine/char_4231_clemnt/char_4231_clemnt)。正背面模型经项目现有 Spine 解析器处理。
- 头像、立绘、图标：[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2/tree/cn/assets/dyn/arts)。较旧的素材镜像尚未收录，资产规划器仅为该角色选用此来源。
- 特殊技能行为：官方 Android 客户端 **2.7.81**，资源版本 **26-10-08-04-51-28-56071834**。核对 `charpack/char_4231_clemnt.ab`、`buff_template_holder.ab`、技能和投射物 prefab，取得放逐舱碰撞框／速度、漩涡半径／持续时间、火箭范围／时序等常量。

下载表的 SHA256、URL、解码摘录与测试输出保存在工作区 `outputs/clementia-upstream/`。GameData 来源使用 master，当时 GitHub API 无法取得提交信息；没有把该来源声称为已固定的提交版本。

## 实现与覆盖

| 项目 | 核对行为 |
|---|---|
| 生死定夺 | 每次物理伤害独立判定，满潜25%；目标防御低于初始值时50%；攻击倍率在扣防御前计算 |
| 习得性防御 | 正面（含同线）或被自身阻挡的敌人造成物理／法术伤害时减伤；海怪标签使用对应减伤；真伤和元素生命伤害不套用 |
| 冲蚀 | 下次攻击倍率、实际物理伤害转侵蚀；闪避和致死攻击不追加存活目标的损伤 |
| 风暴潮 | 放逐舱2格/秒、前进3格、1.1格碰撞框；累计15人／重量8；拒绝飞行与放逐免疫；高台／工事阻挡；取消或死亡后恢复乘客状态 |
| 风暴潮攻击／漩涡 | 主目标加最多5名周边地面敌人；漩涡半径1.5、持续2秒，减速70%，每秒200侵蚀及物理伤害，漩涡可影响空中敌人 |
| 与海为敌 | 普攻3个地面目标、追加侵蚀且不耗弹药；任意来源的地面侵蚀爆发可触发；1秒触发标记；同格5秒排除；火箭十字5格，在+1/+2/+3秒造成物理及元素生命伤害 |
| 火箭收尾 | 最后一发耗尽弹药后，已发出的火箭仍完成攻击；角色死亡清理未完成火箭 |
| 自选入口 | 5／6阶可选、三个技能选项、普通／精英合成记录，客户端选择模型与服务端合法性判断一致 |
| 确定性 | 三个技能的种子重复模拟一致；12套配置的正式 BattleSpec 场景独立保存快照 |

技能参数来自各形态实际黑板，不使用专精三数值替换项目约定的技能等级。当前数据没有该角色模组。

## 验证结果

- 新角色专项：**17项全部通过**，包括14项战斗测试、2项资产测试和1项正式战斗快照测试。
- 相关回归（技能注册、元素机制、资产、自选UI）：**115项中114项通过**。唯一失败是原清单的 `/assets/audio/voice` 目录在本机缺失；已核对该路径在本次改动前存在于清单，原有资产条目均未改变。
- 新增13个资产文件全部存在，PNG尺寸有效。
- Headless Edge 使用游戏正式 Spine 加载器与 `SpineActor` 渲染：正／背面各三个技能，共 **6种通过**，页面无异常、无素材404；已查看生成的截图。
- 新增与修改的相关 JavaScript 文件 ESLint 通过。
- 隔离复制当前工作区，移除本次角色接入后重新运行 DIY 全部场景：之前已有141个场景与旧快照不同，接入后142个。输入相同的 **137个既有场景结果完全一致**；其余场景因新增12套配置而重新分组。新增角色场景 `diy-138` 无内容错误。

因此未用新版结果覆盖全部旧 DIY 快照。为克莱门莎单独保存了 `test/golden/clementia.json`，由 `test/content/op_clemnt_golden.test.js` 验证；旧全局快照仍需要对既有改动单独审核。

复测命令：

```powershell
node --test test/content/op_clemnt.test.js test/content/op_clemnt_golden.test.js test/clementia-assets.test.js
node tools/check-clementia-render.mjs
```

证据：工作区 `outputs/clementia-upstream/` 下的 `regression-final.txt`、`browser-render.json`、`browser-render.png`、`baseline-asset-audit.json` 和 `baseline-battle-audit.json`。

## 当前限制

- 精二头像来源未找到，使用游戏现有的普通头像回退；精二立绘存在。
- 未接入新角色语音和官方放逐舱／舰载火箭粒子，技能提示复用现有通用特效。正背面干员技能动画已接入。
- 战斗引擎统一从技能激活时开始模拟，未另外实现官方起手动画的延迟；地形阻挡使用本项目战场。同一时刻多个侵蚀爆发按敌人生成顺序处理。这些属于复刻引擎约定，代码中已注明。
- 本轮覆盖本地模拟、自选UI逻辑及正式模型渲染，没有做线上真人多人对局验证。发布前还需将13个新素材纳入现有 R2 资源发布流程，再打包并进行线上检查。
