# PC 1.0.8 源码

游戏代码位于仓库根目录。`npm ci`后，Windows请以PowerShell运行`clients/desktop/fetch-runtime.ps1`获取构建脚本指定的Electron运行时，再运行`node clients/desktop/build.mjs`。构建前需将合法来源资源准备到根目录`public/assets`与`public/fonts`。打包程序会按`resource-baseline.json`校验素材；本仓库不包含资源文件和独立的音乐示例ZIP。

已有完整版的玩家使用发布的程序覆盖更新包；完整解压到EXE根目录，不要只复制EXE或在压缩包内运行。

- [玩家指南](Mod使用指南.md)
- [AI／作者指南](Mod制作指南-AI.md)

保留原有20种音乐事件、整局循环BGM、角色跳动／旋转／翻转及组合动作。仅支持受控本地Mod。`examples`仅含清单，需自行提供拥有使用权的音频和图片。
