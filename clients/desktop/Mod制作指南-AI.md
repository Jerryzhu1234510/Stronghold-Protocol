PC 1.0.8 Mod 制作指南：AI／作者版（兼容游戏0.2.5／0.2.6）

文档修订：2026-10-15。覆盖当前受控本地Mod清单、20类音乐触发器、常驻BGM、组合动作及本地预览／训练验收；不开放联网玩法Mod或脚本执行。

本次保留1.0.5/1.0.6的全部外观、音乐和小人动作Mod接口，并增加新模拟构建的受控观察器索引。
好友进房、血量倍率和鸭爵增强由服务器提供；单独更新PC程序不会让正式服自动出现新功能。
旧资源库继续有效，无需重新导入。完整版根目录覆盖 resources/app 即可；保留 servers.json、资源库与已有Mods。
本地测试入口使用 http://127.0.0.1:27627，账号目录与正式服隔离。正式服务器列表保持原样。
Mod当前仅限本地素材、音效、音乐、外观和小人动作；不开放联机玩法Mod开发或规则上传。房间扩展设置是内置功能，随正常版本更新。

# 给AI：PC外观／音效Mod制作协议

目标为卫戍协议PC客户端8443服制作本地Mod。format:1为固定替换，format:2在1.0.2起支持候选，format:3在1.0.3起支持生命归零事件音乐；PC 1.0.4支持下列20种通用音乐事件及同包多事件，PC 1.0.5新增format:4常驻音乐与角色视觉动作配置。不要修改游戏规则、账号、协议或服务器。网页、安卓、icu服不接入此Mod。交付普通ZIP和简短玩家说明。

## 替换与添加

顶层files用于固定替换。variants用于添加多套本地候选，显示在PC顶部“Mods → 外观／音效选择”；每组同时选一个，也可以停用本组。

候选必须映射到已经存在的素材位置，例如干员立绘、小人或攻击声音。接口不会新增游戏内皮肤项、干员或技能。音乐事件只允许下文明确列出的触发器，不能用JS或任意表达式定义新的触发条件。format:4的常驻音乐与视觉动作是两个固定配置接口，不是另外两种events事件。超出范围时向用户明确说明。

## ZIP结构

根目录mod.json和素材，或外层仅一层文件夹。UTF-8、stored/deflate普通ZIP；不加密、不分卷、不用ZIP64。ZIP及全部解压内容各最多256MiB，单文件32MiB；最多5000个ZIP文件、2000个素材映射、100个候选；mod.json最多1MiB。

```text
my-pack/
  mod.json
  images/portrait-a.png
  images/portrait-b.webp
  audio/attack-a.wav
  README.txt
```

format:2示例。以下路径、哈希是占位符，**必须查实际资源清单并替换后才可打包**。

```json
{
  "format": 2,
  "id": "my-local-style",
  "name": "我的外观与音效",
  "version": "1.0.0",
  "server": "8443",
  "description": "作者、素材来源、许可与适配版本",
  "files": [],
  "variants": [
    {
      "id": "portrait-a",
      "group": "operator-portrait",
      "groupName": "某干员立绘",
      "category": "appearance",
      "name": "外观A",
      "default": true,
      "files": [{
        "target": "/assets/实际原版路径.png",
        "originalSha256": "实际原始文件的64位小写SHA256",
        "path": "images/portrait-a.png"
      }]
    },
    {
      "id": "portrait-b",
      "group": "operator-portrait",
      "groupName": "某干员立绘",
      "category": "appearance",
      "name": "外观B",
      "files": [{
        "target": "/assets/实际原版路径.png",
        "originalSha256": "同一个原始文件的64位小写SHA256",
        "path": "images/portrait-b.webp"
      }]
    },
    {
      "id": "attack-a",
      "group": "operator-attack",
      "groupName": "某干员攻击声",
      "category": "audio",
      "name": "短促攻击声",
      "files": [{
        "target": "/assets/audio/实际原版音效.mp3",
        "originalSha256": "实际原始音频的64位小写SHA256",
        "path": "audio/attack-a.wav"
      }]
    }
  ]
}
```

id/group/variant.id为1—48字符，只用小写字母、数字、短横线、下划线；variant.id全包唯一。name/groupName最多64字符，version为1—32字符字符串。server固定8443。每个候选至少一个files项；固定files和variants至少有一项。同组groupName/category一致，最多一个default:true，否则默认第一项。不同组不能映射同一个目标，同组可各自提供完整多文件皮肤。

target为实际服务器清单中的规范URL，以/assets/或/fonts/开头。每个路径段URI编码中文、空格、方括号等，保留目录斜线。originalSha256是**原始资源**哈希，不是替换文件哈希。path为ZIP内相对路径，禁止绝对路径、反斜线、空路径段、..。每个files列表不能重复target，不区分大小写。

## 类型

- 图片：PNG/JPEG/WebP/GIF/AVIF，可在同类编码间互换，按替换后缀返回MIME。
- 音频：MP3/OGG/WAV/M4A/AAC/OPUS/FLAC；音效、语音、BGM均可，支持Range。保持合理音量、时长；循环点仍取决于游戏逻辑。
- 字体：WOFF/WOFF2/TTF/OTF，可在字体编码间互换，包含所需中文字形。
- Spine：SKEL和ATLAS各自只能替换同类型，纹理作为图片项配套。保持骨骼版本、图集纹理名/相对位置、UV、尺寸和动画名称兼容。
- appearance组只能含非音频，audio组只能含音频；顶层files可以混合以上类型。
- 不支持SVG、JS、HTML、JSON玩法配置、EXE、DLL或3D模型作为目标，不会执行代码。

## 查路径和原始哈希

随包 `Mod目标素材清单-0.2.5.json` 的entries[target].hash/bytes提供基准。正式适配优先看当前服清单：

1. GET `https://weishuxieyiwangye.cn:8443/resource-policy/status.json` 获取build。
2. GET `https://weishuxieyiwangye.cn:8443/_build/BUILD/data/resource-cache.json`，查entries。
3. 按干员ID/声音名搜索，再用源码确认实际使用位置。不要猜哈希或路径。

原始哈希变化时映射自动跳过。更新Mod保留id，提高version并适配新哈希。同ID更新保留仍存在的候选选择，删除的选项回退默认。

## 工具与验收

mod-tool.cjs、mods.cjs、resources.cjs放一起，Node.js22+，零第三方依赖：

```powershell
node mod-tool.cjs pack .\my-pack .\my-pack.zip --targets .\Mod目标素材清单-0.2.5.json
node mod-tool.cjs validate .\my-pack.zip --targets .\Mod目标素材清单-0.2.5.json
```

ZIP放在素材目录外，不覆盖已有文件。工具检查结构、类型、大小、重复项与目标哈希，不验证美术/动画内容是否正确。

实际导入PC，逐组切换并重新载入，触发图片/音效，检查多文件角色外观；停用恢复原版，重启确认选择保存。交付说明写明适配版本、作用位置、来源/许可和限制。不要把账号资料、签名私钥或整个游戏素材库打进去。

旧format:1仍兼容，只含顶层files、不含variants。后安装的已启用包优先；同包所选候选优先于固定files。“本组选原版”只停用本组，固定files和其他包仍可生效。

## 受控事件音乐（format:3，通用事件需要PC 1.0.4）

format:3可以继续使用files与variants，并增加events。仅做事件音乐时，不需要目标素材原始哈希，files可为空。示例：

```json
{
  "format": 3,
  "id": "my-teammate-music",
  "name": "队友淘汰音乐",
  "version": "1.0.0",
  "server": "8443",
  "description": "写明音频作者、来源和适配版本",
  "files": [],
  "events": [{
    "event": "teammate-zero-lp",
    "path": "audio/music.mp3",
    "volume": 0.8,
    "startSeconds": 0,
    "includeBots": true,
    "includeSelf": true
  }]
}
```

PC 1.0.4中events最多32项，同一event在同包只能出现一次；目前允许20种内置事件，见下表。path必须指向包内存在的MP3、OGG、WAV、M4A、AAC、OPUS或FLAC，单文件不超过32MiB。不接受外部网址、绝对路径、上级路径、脚本、未知事件或事件额外字段。volume为0～1的有限数值，默认0.8，乘游戏BGM音量；startSeconds为0～3600的有限数值，默认0；includeBots为布尔值，默认true。includeSelf为布尔值，默认false；设置true时，旧teammate-zero-lp事件也包含本机玩家，要求本次更新的PC 1.0.3及以上。旧包省略此字段，保持仅队友触发；不要在旧客户端上承诺自身触发。省略可选字段才使用默认值，null或错误类型会被拒绝。

| event | 触发名称 |
| --- | --- |
| match-start | 新对局开始 |
| round-start | 新回合开始 |
| combat-start | 战斗开始 |
| boss-start | Boss战开始 |
| unite-start | 联防战开始 |
| prep-start | 休整期开始 |
| round-end | 普通本轮结算，无论本轮胜负 |
| round-win | 本回合胜利 |
| round-loss | 本回合失利 |
| match-win | 整局胜利 |
| match-loss | 整局失败 |
| match-end | 整局结束 |
| low-lp | 低生命值 |
| self-zero-lp | 自己生命值归零 |
| teammate-zero-lp | 队友生命值归零（保留旧版includeSelf行为） |
| core-alliance-6-combat-start | 本人部署中的同一核心盟约达到6人时战斗开始 |
| core-alliance-9-combat-start | 本人部署中的同一核心盟约达到9人时战斗开始 |
| siracusa-true-damage | 本人叙拉古专属真伤效果触发 |
| kjerag-operator-freeze | 本人谢拉格干员造成冻结 |
| kjerag-alliance-freeze | 本人谢拉格盟约效果造成冻结 |

low-lp可以额外提供threshold，表示绝对LP阈值，为1～999整数，默认5；例如threshold:5表示5点LP，不是5%。其它事件禁止携带threshold。只监听内置事件，不接受自定义表达式、百分比阈值或JS条件。生命周期事件中的includeBots/includeSelf字段仍按相同类型校验，但不会改变“回合开始”等事件本身的判定含义。

普通轮结算事件要求本机亲历该轮普通战斗再进入SETTLE：round-end不区分本轮胜负，round-win表示本机玩家本轮服务端结算LP损失为0，round-loss表示损失大于0。联防优先读取uniteResult.losses中的本人损失；缺少该项时才用COMBAT阶段基线LP减SETTLE阶段LP。预测字段pendingLp不计入结算损失。Boss流程不进入普通SETTLE，不产生这三个普通轮事件；不要根据Boss动画、局部胜败或预计漏怪伤害伪造结算触发。

match-end、match-win和match-loss只根据新增的m.result整局结果触发，并按resultId去重；离开房间、断线或没有结果快照都不等于整局失败。整局胜负采用顶层result.victory团队结果，与正式结果页一致；不要优先读取players[]中个人行的victory，已淘汰玩家也可以随团队获胜。隐藏核心局部失败不能直接当作整体失败。重复结果、刷新及重连不补播旧结算。一个状态同时命中多种事件时，客户端按内置优先级选择音乐，不执行Mod自定义优先级或表达式。

两个核心盟约事件只在战斗开始时检查本人已经部署的干员，同一核心盟约分别达到至少6人、至少9人；按不同基础干员baseId去重，只计算8类核心盟约，整备区、调和harmony计数和策略提供的虚拟人数不计入，不合并不同核心盟约人数，也不合并队友人数。达到9人时，9人事件优先于6人事件。这是固定受控触发条件，不能通过threshold等额外字段更改人数要求。

siracusa-true-damage是固定特殊事件：仅监听当前实际播放的本人战场里的叙拉古专属真伤proc，使用bondProc特效事件中src=bond:siracusaShip、key=assassin的专属标记，不从通用真实伤害、伤害数字颜色或盟约层数推断，也不计入队友战场事件。标记表示叙拉古真伤效果被触发，出现在伤害结算之前；后续可能受护盾或免疫影响，不保证敌人最终损失HP。音乐不改变伤害逻辑。客户端统一2秒节流，不开放cooldownSeconds、threshold或其它自定义条件字段；实际是否播放还须通过下述优先级和播放状态判断，并非保证每2秒重播。

生命归零事件读取合作模式玩家的权威LP从正数到0；teammate-zero-lp默认只含队友，includeSelf:true也含自身，self-zero-lp固定表示自己。不是干员HP、预计漏怪扣血、玩家离开或对抗模式中的敌人。每个玩家每局至多一次；初始快照已经归零、重复同步、断线重连不补播。多名玩家同时归零按事件优先级选择一个；停止／停用不会重新触发已经消费的事件。

### 事件音乐的冲突规则

同一帧只从已配置、已启用的候选里选择优先级最高的一个。优先级由客户端固定，从高到低为：

```text
match-win / match-loss
> match-end
> self-zero-lp
> teammate-zero-lp
> low-lp
> core-alliance-9-combat-start
> core-alliance-6-combat-start
> boss-start
> unite-start
> siracusa-true-damage / kjerag-operator-freeze / kjerag-alliance-freeze
> round-win / round-loss
> round-end
> combat-start
> match-start
> round-start
> prep-start
```

高优先级新事件可以打断正在播放的低优先级事件音乐；同优先级或低优先级呼叫直接忽略，不排队、不叠播、不从头重播当前音乐。同一种事件由后安装的已启用包提供音轨；安装顺序不会改变不同事件之间的固定优先级。Mod不能自定义priority、冷却或表达式。试听不能替代真实触发器及优先级验收。

三个特殊战斗触发器同级，同帧同时命中时按客户端固定稳定事件顺序选一个；两个谢拉格冻结触发器分别采用客户端2秒节流，精确区分干员来源与盟约来源，不接受Mod提供自定义判断条件。干员携带的装备也可能以该干员作为source；当前接口不继续细分技能、天赋与装备来源。

谢拉格两类冻结适配0.2.5本地模拟中从未冻结到真正新进入冻结的事件。只出现寒冷、目标免疫、延长已经存在的冻结、刷新时已有冻结，以及非本人当前战场均不作为新冻结触发。原始网络状态不携带完整冻结来源，客户端通过校验过源码哈希的只读本地模拟观察，区分谢拉格干员与盟约效果，不修改伤害、随机数或服务器规则。匹配不到已验收的源码哈希时，该观察桥安全停用；不得宣称未经验证的后续游戏版本也一定兼容。Mod本身不能提供观察代码或修改适配计划。

本次已只读核验8443线上build fd4dbe120420-2的浏览器模拟源码与观察计划一致。重新生成观察计划、运行sim-music-observer-test.mjs与sim-music-observer-bundle-test.mjs，需要把完整对应server-025源码放在源码根目录，与clients同级，并在server-025运行npm ci安装开发依赖（包括acorn）。这些是开发验收依赖，已打包PC运行时不需要安装acorn。

播放期间仅临时压低原版BGM，不写回玩家音量设置；结束、停用、退出对局恢复。无用户手势导致自动播放受限时，最多等待30秒内的真实点击或按键，之后丢弃。静音或背景音量为0时直接忽略，不在解除静音后补播。

同一事件的多个Mod按后安装的已启用包优先。旧format:1/2不能包含events。事件音乐同样使用mod-tool.cjs打包校验，但不需要--targets；若同时包含静态替换，仍应校验目标清单。

### 新对局开始与同包多事件（PC 1.0.4支持补丁）

将示例event改为match-start即可：

```json
"events": [{
  "event": "match-start",
  "path": "audio/initial-helldive-theme.mp3",
  "volume": 0.8,
  "startSeconds": 0
}]
```

match-start只在玩家正常开始一场新对局时播放一次。普通回合切换不触发；刷新、重连或中途接入已有对局不补播。离开后开始另一场新对局可再次触发。其它生命周期事件也按真实状态变化触发，重复快照及重连不补播过去事件。播放音量、用户手势、停用与恢复BGM遵循上述限制。未安装PC 1.0.4支持补丁的旧客户端会拒绝新事件或多事件包，不要宣称仅更新Mod就能在旧版启用。

同包可以组合不同事件，并重用一段本地音频。例如：

```json
"events": [
  {"event": "match-start", "path": "audio/intro.mp3"},
  {"event": "boss-start", "path": "audio/boss.mp3", "volume": 0.7},
  {"event": "low-lp", "path": "audio/warning.wav", "threshold": 5},
  {"event": "match-win", "path": "audio/victory.mp3"}
]
```

启停整个包时，上述事件一起启停；需要分别开关时拆成独立Mod。不同包的优先级按每种事件分别计算，一个后安装的Boss音乐包不会覆盖其它包的新对局开始音乐。PC 1.0.3旧单事件teammate-zero-lp包可直接继续使用。

交付前在真实客户端导入，使用“试听音乐 Mod”和“停止音乐 Mod 播放”验收音频解码、音量、停止、停用与恢复BGM。开发者验收另外通过真实store的正数→0更新验证，勿仅以试听代替事件验证。只能使用用户提供或有权使用的音频，不擅自下载歌曲填充。

## 常驻音乐与角色视觉动作（format:4，PC 1.0.5起）

format:4继续兼容files、variants、events，并新增可选sessionMusic和motion。可以只提供其中一个，既不需要占位files，也不需要虚构events。纯视觉动作包只放mod.json也合法；纯常驻音乐包只需清单与本地音频。现有format:1/2/3包无需改格式即可继续使用；旧客户端不能仅导入format:4来增加程序能力。

升级PC程序后的首次启动会自动刷新HTTP脚本缓存以启用新适配，保留账号、本地存储、已装Mod和本地资源库，不需要用户手动清数据。

```json
{
  "format": 4,
  "id": "my-session-dance",
  "name": "整局音乐与跳舞",
  "version": "1.0.0",
  "server": "8443",
  "description": "作者、音频来源、许可和适配版本写在这里",
  "sessionMusic": {
    "path": "audio/music.mp3",
    "volume": 0.8,
    "startSeconds": 0
  },
  "motion": {
    "target": "allies",
    "bounceHeight": 0.2,
    "bounceHz": 1,
    "spinRps": 0.5,
    "flipX": false,
    "flipY": false
  }
}
```

format:4顶层仅允许format、id、name、version、server、description、files、variants、events、sessionMusic、motion；description若提供必须为字符串。作者与来源写进description，不额外添加author、script、url等字段。新配置对象也严格拒绝未知字段、JS、表达式、任意网络地址与路径越界。音频和ZIP大小限制沿用前文，导入时由客户端计算并保存内容哈希，播放时再次校验，不信任包内自行提交的hash或bytes。

### sessionMusic

只允许path、volume、startSeconds。path为包内音频相对路径，类型与事件音乐相同，不接受外部URL、绝对路径、反斜线、空段、.或..。volume为0～1有限数值，默认0.8；startSeconds为0～3600有限数值，默认0。省略才使用默认值，null、字符串或其它类型不合法。循环和生命周期由客户端固定管理，不添加loop、event、once、includeBots、priority等字段。

常驻音乐在对局期间循环：新对局开始后播放，整局RESULT、离房或停用时停止并恢复原版BGM。它是状态型背景音乐，允许在当前对局重新配置或断线重连后恢复；与match-start一次性事件不同，不能套用“重连绝不补播”的事件规则。同一页面保留的播放位置可继续使用，不承诺刷新或重启进程后仍恢复到完全相同秒数。

事件音乐播放时临时暂停常驻音乐并保留位置；事件结束后从原位置恢复。静音、游戏BGM音量0或本配置volume:0时不创建新的Audio播放；已有常驻音乐暂停并保留位置，解除静音或恢复有效音量后可开始／续播。游戏音量仍乘本配置volume，不写回用户设置。

首次自动播放若被内核限制，常驻音乐会持续保留可信点击／按键解锁监听，直到成功、停用或离开对局；不套用一次性events最多30秒的过期规则。无需伪造点击，也不能由Mod提供自动解锁脚本。

用户主动“停止音乐Mod播放”后，常驻音乐本局保持停止，直到明确重新配置／启用常驻包或开始下一场新局；后续新的事件音乐仍可触发。不要让定时同步、普通回合或音量改变绕过这次手动停止。

同时只选一个常驻音乐包：最后安装或从停用切回启用的配置优先；停用它后回退到仍启用的下一个配置。此顺序持久化保存，独立于旧events与静态替换的安装优先级。对局中明确配置可即时生效，无需等待另一场对局。

### motion

只允许target、bounceHeight、bounceHz、spinRps、flipX、flipY；不得提供模型代码、函数、资源URL或其它位置／玩法字段。

| 字段 | 合法值与默认值 |
| --- | --- |
| target | 必填own或allies；own为本人干员，allies为己方干员（含本人和队友） |
| bounceHeight | 有限数值0～0.75，默认0.2；视觉跳动的相对高度 |
| bounceHz | 有限数值0.1～4，默认1；每秒跳动周期数 |
| spinRps | 有限数值-2～2，默认0.5；每秒旋转圈数，正负控制方向 |
| flipX | 布尔值，默认false；左右镜像，仅影响小人视觉 |
| flipY | 布尔值，默认false；上下翻转，仅影响小人视觉 |

至少bounceHeight大于0、spinRps不为0、flipX为true或flipY为true之一成立，完全无效果的配置拒绝。两个flip字段仅接受布尔值，不接受0/1、字符串或null；旧format:4配置省略它们时按false恢复。只给本人或己方op干员增加跳动／旋转／翻转外观；不作用于敌人和召唤物，不修改棋盘坐标、移动、朝向逻辑、射程、命中、战斗状态、伤害或RNG。动作与素材替换可组合，但不会改变服务器上其它玩家看到的内容。

仅做左右镜像也合法，例如motion:{"target":"own","bounceHeight":0,"spinRps":0,"flipX":true,"flipY":false}；只做上下翻转则交换两个flip值。示例包的flipX／flipY均默认false，不会自动让所有人倒立；它们可与跳动、旋转组合。

翻转跳跃组合可以同时配置。以下motion让本人干员每秒跳一次并视觉转一圈，同时保持左右镜像：

```json
"motion": {
  "target": "own",
  "bounceHeight": 0.3,
  "bounceHz": 1,
  "spinRps": 1,
  "flipX": true,
  "flipY": false
}
```

在合法范围内令spinRps=bounceHz可一跳转一圈（因此bounceHz取不大于2），设为-bounceHz则反向。flipX／flipY是静态镜像／翻转开关，可同时叠加，不是用于触发某个时刻的翻转动画。这里描述小人的本地视觉转圈和跳动，不引入物理运动。附带示例采用高度0.3、bounceHz:1、spinRps:1，两个flip仍为false。

motion只有一个全局最高优先配置，按最后安装／重新启用决定；不是按own/allies分别叠加，胜出包未覆盖的目标也不向低优先包寻找补充。停用、移除或替换后即时恢复原始视觉变换；离房、结束对局或失去兼容渲染状态也停止应用。只在本机受控渲染适配中生效，源码哈希不匹配时不向未知版本强行注入。

制作与校验仍用mod-tool.cjs，无静态替换时不需要--targets。验收至少覆盖：对局开局／重连／结算与离房、事件插播后恢复常驻位置、静音与手动停止、切换两个常驻包、own/allies目标、跳动／旋转／单独翻转的参数边界、停用立即恢复及旧Mod共存。纯音乐Mod不能替代受控动作代码，Mod作者不能上传自己的执行逻辑。


## PC 1.0.6 / 游戏0.2.6兼容

保留1.0.5全部接口，兼容原有1.0.3/1.0.4/1.0.5 Mod。新增0.2.6渲染适配，保留8443现有0.2.5适配；未知源码仍跳过注入。素材按实际哈希匹配，新版哈希URL会归一化后查本地资源及Mod。作者可使用Mod目标素材清单-0.2.6.json；通用事件和format:4字段无需改写。
程序更新包解压覆盖到EXE所在目录，Mod ZIP从Mods菜单导入。旧资源继续有效，程序包不替代缺失素材补全包。

## PC 1.0.8：本地 Mod 预览室

从客户端顶部“Mods → 本地 Mod 预览室”打开独立窗口。无需连接游戏服务器，也不会退出主窗口正在进行的对局。选择“当前启用组合”可检查实际生效的音乐、动作和图片；选择单个包可预览未启用包及所有候选素材，不会修改正式勾选或候选设置。

- 20 个音乐事件逐项试听，包括 Boss 战、同核心盟约 6/9 人、叙拉古真实伤害、谢拉格冻结；未配置的事件置灰。试听使用包内真实音频、起播位置及音量。
- 整局 BGM 可以开始循环、停止；事件音频播放完后恢复循环。预览音量只影响预览窗。
- 选择内置干员立绘或已安装包的图片，检查原图对照、跳动、旋转与横向/纵向翻转。动作复用游戏的 2D 接口；这里是图片预览，不拼装 Spine 骨骼。完整小人外观需要在训练场实际部署后验证。
- 音效替换项也可以直接试听。骨骼、图集和字体列出清单供核对，不作为普通图片解码。
- 点击“停止全部声音与动作”或关闭窗口可停止预览。导入或切换包后，点击“刷新已安装包”更新列表。

本地训练场位于顶部“游戏 → 本地训练场（独立窗口）”，需要先运行本地兼容测试服的“启动房间扩展本地测试服.cmd”。训练场使用真实模拟与渲染检查配装/皮肤；预览室试听跳过触发条件，所以“能试听”不等于游戏里的事件条件已经满足，最终仍需验证对应战斗触发。以上功能仅限受控本地 Mod，不开放脚本和联网玩法 Mod。

训练场也支持已启用的受控音乐和小人动作：开始训练后播放循环 BGM，按所选战场触发开战／Boss 音乐，并观察真实战斗事件（如叙拉古真实伤害、谢拉格冻结）。暂停、页面切到后台、训练结束或离开时停止播放与动作，继续训练不会重复播放 Boss 开场曲。训练使用独立本地状态，不连接正式房间；队友生命、联防和整局胜负等未模拟的事件请使用预览室试听，再在对应正式玩法中验证触发条件。
