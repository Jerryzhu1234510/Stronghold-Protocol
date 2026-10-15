import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const require=createRequire(import.meta.url),{pack}=require('./mod-tool.cjs'),{parseMod}=require('./mods.cjs');
const source=process.argv[2]||path.join(here,'examples/Initial-Helldive-开局音乐/audio/initial-helldive-theme.mp3');
const audio=await fs.readFile(source),sha=body=>createHash('sha256').update(body).digest('hex');
assert.ok(audio.length>0&&audio.length<=33554432);
const folder=path.join(here,'examples/整局跳舞与循环BGM');await fs.mkdir(path.join(folder,'audio'),{recursive:true});
await fs.writeFile(path.join(folder,'audio/initial-helldive-theme.mp3'),audio);
const manifest={format:4,id:'initial-helldive-dance-session',name:'整局跳舞与循环BGM-示例',version:'1.0.0',server:'8443',
 description:'PC1.0.5：本人干员显示跳动旋转，整局循环用户提供的Initial Helldive Theme。事件音乐可暂时插播；所有效果仅在本机生效。',
 files:[],sessionMusic:{path:'audio/initial-helldive-theme.mp3',volume:0.7,startSeconds:0},
 motion:{target:'own',bounceHeight:0.3,bounceHz:1,spinRps:1,flipX:false,flipY:false}};
await fs.writeFile(path.join(folder,'mod.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(folder,'README.txt'),`整局跳舞与循环BGM 示例Mod v1.0.0

适用：Windows PC客户端1.0.5、8443服。
先完全退出客户端，将1.0.5程序更新包解压到EXE所在根目录覆盖，再启动。
然后顶部“Mods → 导入外观／音效 Mod ZIP…”导入本Mod ZIP，安装并启用。
不要把程序更新包、网页素材包或PC资源补全包当作Mod导入。

效果：本人部署干员及整备区干员显示“一跳转一圈”的翻转跳跃；整局循环播放用户提供的
Wilbert Roget II - Initial Helldive Theme.mp3，采用游戏BGM音量×0.7。
不修改角色的位置、朝向、命中、伤害、技能或服务器规则。
游戏大厅、结算页、旁观席不播放整局BGM或跳舞；同局中途加入可启动常驻BGM。
断线时暂停；同房间恢复后从暂停处续播。刷新整个页面会重新从设置的起点播放。
事件音乐临时插入后，整局BGM从原位置续播，不叠加两首。
若已启用同曲的“Initial Helldive-开局音乐”单次事件Mod，可停用它以免先播一次开场再进入循环。

“Mods → 停止音乐 Mod 播放”会让整局BGM在本局保持停止，跳舞继续。
重新启用包或开始下一局可恢复音乐；停用整个包会恢复小人显示并停止音乐。
本示例不自动启用，需要导入确认。旧版外观/事件音乐Mod仍可使用。
3D与2D观察器适配当前0.2.5源码，哈希不匹配时跳过动作；不要求更新云服务器。

修改target为allies可让己方全部干员显示动作；bounceHeight控制每格高度比例，
bounceHz控制每秒跳动次数，spinRps控制每秒旋转圈数，负数反转，0关闭旋转。
把bounceHeight设为0可只旋转，把spinRps设为0可只跳动。
将spinRps设为与bounceHz相同数值，可在每次跳跃中转一整圈，落地时回正。
flipX:true为左右镜像，flipY:true为上下翻转，也能与跳跃和旋转同时开启。
示例默认不镜像、不上下翻转；它演示的是显示模型旋转，不是新的物理动作或技能。
详细边界、制作与打包方法见通用玩家教程和AI制作指南。
本包内只有清单、本地音频和说明，无执行脚本。
`);
const body=await pack(folder),parsed=parseMod(body);assert.equal(parsed.manifest.format,4);
assert.equal(parsed.manifest.motion.target,'own');assert.ok(parsed.manifest.sessionMusic);
assert.equal(parsed.payload.size,1);assert.deepEqual([...parsed.payload.values()][0],audio);
const dest=path.join(root,'deliverables/整局跳舞与循环BGM-示例Mod.zip');await fs.writeFile(dest,body);
const receipt={ok:true,file:dest,bytes:body.length,sha256:sha(body),audioSha256:sha(audio),audioCopiedVerbatim:true,format:4,requiresClient:'1.0.5'};
await fs.writeFile(path.join(root,'deliverables/session-motion-example-packaging.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
