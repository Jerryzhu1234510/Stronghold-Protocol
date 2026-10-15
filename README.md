# 卫戍协议 · 8443服 0.2.6 r05

基于卫戍协议社区项目与 ICU custom-v026 分支整理的 8443 兼容版本。当前游戏版本 **0.2.6 r05**，PC 客户端 **1.0.8**，安卓客户端 **1.0.2**。

## 本版功能

- 账号、好友与历史记录；好友邀请、申请加入及观战。
- 累计杯数：正常4～8人终极通关8杯。只增强Boss／其他敌人血量不减杯；克隆、取消Boss限伤或鸭爵增强减半一次。
- 房主统一管理Boss／小怪血量×1～×96、取消Boss限伤和鸭爵两档增强。开局后锁定规则。
- PC本地素材、音效和外观Mod；20类音乐触发器、整局循环BGM、小人跳动／旋转／翻转组合、本地预览室与训练场。
- 选服大厅、浏览器本地资源库、ZIP导入与安卓内置资源方案。旧完整资源包v2＋0.2.5补全包继续可用。

## 从源码运行

需要Node.js 22及以上，推荐24。

```sh
npm ci
npm run build:browser
npm start
```

按终端提示访问本机地址。仓库包含代码与数据表，不附带游戏图片、模型、字体、商业歌曲或打包后的客户端。若需完整画面，请按上游[素材说明](docs/ASSETS.md)准备合法来源的资源；资源缺失不等同于程序缺失。

账号保存在部署者自己的持久目录；正式部署请先阅读[热更新与账号说明](docs/HOT_UPDATE_PREVIEW.md)和[部署指南](docs/DEPLOY.md)。`deploy/8443-front`为资源入口／HTTPS代理源码，站点证书、签名密钥和生成的资源变体需自行配置，不含本服生产配置。

## 客户端与Mod文档

- [PC源码和构建说明](clients/desktop/README.md)
- [玩家Mod通用指南](clients/desktop/Mod使用指南.md)
- [AI／作者Mod制作指南](clients/desktop/Mod制作指南-AI.md)
- [安卓源码说明](clients/android/README.md)

本地Mod只影响本人看到和听到的内容，不开放联网玩法Mod或任意脚本。示例目录只保留清单与文字；音频和图片需由作者自行提供。

## 验证

```sh
node --test test/match/trophies.test.js test/account-trophies.test.js test/room-extensions.test.js
node tools/test-local-mods.mjs
```

完整测试仍包含上游内容数量基线检查；本次发布未宣称整个上游测试集全部通过。正式服切换前另做了隔离账号、好友RPC、重复结算、全部素材哈希与HTTPS入口验收。个人账号、数据库、登录令牌、证书、签名密钥、日志和电脑上的私人文件不属于仓库内容。

## 来源与许可

上游：[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)、[ICU custom-v026](https://gitee.com/last-wolf/Stronghold-Protocol/tree/custom-v026)。本仓库保留原有Git历史和[GPL-3.0许可证](LICENSE)，同时保留[原作者声明](NOTICE.md)与[第三方说明](THIRD-PARTY-NOTICES.md)。游戏美术、名称和音频归各权利人所有，不因代码开源而获得再分发授权。仅供非商业学习交流。

8443服交流群：**455814975 / 1127927007**。
