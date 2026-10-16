import fs from 'node:fs';
const messages={
 '更新公告':'Update notes','问题反馈群：':'Feedback groups: ','455814975（已满）':'455814975 (full)',
 'v0.3.0 · 8443本地兼容候选版':'v0.3.0 · Local 8443 compatibility candidate','我知道了':'Got it',
 '本地验收中，尚未更新正式服务器':'Local testing; the live server has not been updated',
 '以官方0.3.0为基础。战斗规则、干员、策略、皮肤语音、特效、场景和素材导入优先使用官方实现。':'Based on upstream 0.3.0. Upstream implementations take priority for combat rules, operators, strategies, skins, voices, effects, scenes and asset imports.',
 '保留账号、好友邀请和申请入房、观战、历史、累计杯数、4～8人房间、克隆模式和房间扩展。房间扩展默认关闭；本地外观与音乐Mod不改变联机规则。':'Accounts, friend invitations and join requests, spectating, history, account trophies, 4–8 player rooms, clone mode and room options remain available. Room options default to off; local cosmetic and music Mods do not alter network gameplay.',
 '终极正常4～8人通关8杯；仅提高Boss或其他敌人生命不降杯。克隆、个人卡池、取消Boss限伤或鸭爵加强减半一次。训练不计杯。':'A normal 4–8 player Ultimate clear awards 8 trophies. HP-only increases do not reduce trophies. Clone mode, personal pools, removing the boss damage limit or enhanced Ducklord halve the award once. Training awards none.',
 '旧资源包继续复用，不用清空；0.3.0新增素材需要补充。8443关闭服务器素材预下载，缺失文件提示补导，不自动重复下载。':'Keep existing asset packs and caches; add the new 0.3.0 assets. Server asset preloading is disabled on 8443. Missing files prompt an import instead of repeated server downloads.',
 '本地Mod继续支持音乐、外观和小人动作；官方插件管理采用官方界面。当前测试入口未开放联网玩法插件。':'Local Mods still support music, cosmetics and unit animations. Upstream plugin management uses the upstream interface. Network gameplay plugins are disabled in this test launcher.',
 '新版客户端和资源补全包以服主实际发布的文件为准。当前页面不代表已上传群文件或网盘。':'Use the client and supplementary assets actually published by the server owner. This page does not confirm an upload to a group or cloud drive.',
};
for(const lang of ['en','ja','ko','zh-TW']){const f=`public/i18n/${lang}.json`,p=JSON.parse(fs.readFileSync(f));for(const[k,v]of Object.entries(messages))p[k]??=v;fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n');}
console.log('Compatibility notices added; existing upstream translations preserved.');
