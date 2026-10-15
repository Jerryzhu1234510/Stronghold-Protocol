# 2026-10-08 连接与内存排查记录

服务器：2 GB 内存，v0.2.1。以下是实际采样，不是 300 人容量压测。

## 查到的占用

- 修复前整机已用内存约 1.76～1.82 GB，交换分区占用约 1.5～1.7 GB。
- HTTPS 代理堆剖析中至少约 360 MB 为 Zstd 压缩缓冲；代理总堆占用约 730～800 MB。
- 热更网关堆外 Buffer 约 507 MB；旧版 r04、r05 进程各保留约 150 MB 数据和运行时。
- 内核反复报告 `TCP: out of memory`，并出现每秒几十 MB 的换页写入。
- 因此内存并不只随在线人数变化。HTTPS 压缩、素材传输、多个版本和断线对局都有额外占用。

## 已在线生效

1. HTTPS 改为 gzip 1，停用 Zstd；保留文本压缩。
2. 当前版本的素材由 Caddy 直接提供。`/config/game-static/_build/<generation>/assets` 使用素材硬链接，不增加一份完整素材数据；未镜像的路径仍走原网关。
3. Caddy 保留旧 WebSocket 流最多 6 小时，避免配置重载立即关闭所有连接。
4. 空闲 r05 已安全清理。旧 r04 当时有断线对局，没有主动清理。
5. TCP 发送积压阈值改为 64 KB，临时恢复参数已保存在 `/etc/sysctl.d/90-stronghold-memory.conf`，原参数备份在 `/home/ubuntu/stronghold-hot/tcp-before-recovery-20261008.conf`。
6. 已退役的旧版页面入口跳转到首页。正常玩家使用 `https://weishuxieyi.icu/`，不要把 `_build` 地址作为永久入口。

## 诊断事故及限制

12:07 的网关堆诊断中，调试接口执行的动态导入触发 `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` 未处理异常。游戏容器因此自动重启了一次。重启前仅在内存中的房间和对局进度已经丢失，无法恢复。这不是无损热更；不能把重启后的全部内存下降都归因于配置优化。

在事故前，仅修改压缩配置就已经使 Caddy 活跃堆从约 760 MB 降至约 123 MB，并显著减少换页。之后的诊断不再对在线游戏进程使用调试执行接口。

## 验证

- 真实 HTTPS 私人测试对局：配置重载后断线、使用原 token 重连，同一身份和房间恢复，游戏操作成功。
- 素材响应 `X-SP-Asset-Source: static`，图片内容 SHA-256 与原文件一致；旧入口响应 302。
- 最新采样：60 名在线真人、17 场对局，整机已用 827 MB，可用 1140 MB，交换分区 103 MB。
- 连续三秒采样换页读写均为 0，磁盘等待均为 0；11:49:58 后没有新增 TCP 内存不足日志。
- 本地 4 项网关测试通过，覆盖取消 GET 的上游释放及热更后原房间恢复。
- 尚未进行 300 人并发验证，不能保证与昨天 700 MB 严格等价。

## 已准备、下次网关启动才生效

`server/hot/gateway.mjs`：客户端取消已发完的 GET 时关闭上游响应；文本缓存同时计算原文和 gzip 的字节数，避免遗漏压缩缓存占用。已备份并更新服务器 `/home/ubuntu/stronghold-hot/entry/server/hot/gateway.mjs`。运行中的网关仍使用启动时载入的旧代码；不要为这项修改强制重启正在进行的对局。

## 以后更新素材直供

当前 Caddy 配置自动检测磁盘中的素材；新的版本没有镜像时仍会通过网关提供资源，不会因此 404。热更成功后从 `/__hot/status` 读取实际 generation，把该版本 `public/assets` 镜像到 `/home/ubuntu/stronghold-https/config/game-static/_build/<generation>/assets` 即可。镜像只包含游戏素材，不能放入服务端代码、密钥或上传数据。不同版本使用独立目录，禁止覆盖正在使用的素材。镜像已有素材采用硬链接；不必每次复制 700 MB。

检查命令：

```sh
free -m
vmstat 1 5
sudo docker stats --no-stream
curl -fsS https://weishuxieyi.icu/healthz
curl -fsS http://127.0.0.1:14517/__hot/status
sudo dmesg --ctime | grep 'TCP: out of memory' | tail -5
```

`vmstat` 第一行是开机以来平均值；比较后面的采样行。`buff/cache` 是可回收文件缓存，不应与进程占用直接相加。只有对局和连接均为 0 的旧版本才可以 `retire`。
