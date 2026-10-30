# 1.3.4

修掉一个让「应用内更新永远装不上」的根因：host 收到 shutdown 后不退出。

## 与上一版本 v1.3.3 的对比

| 维度 | v1.3.3 | v1.3.4 |
|---|---|---|
| 应用内更新 | 点「安装并重启」报 `Host did not complete graceful task teardown` | 正常安装并重启 |
| host 退出时机 | 关完插件后靠事件循环自然结束（20 个插件的活句柄让它永不退出） | 回完 `shutdown-complete` 立即 `process.exit(0)` |
| 补丁总数 | 76 条 | 77 条（新增 #89） |
| 面板计数 | 70/71（#89 因目标 key 不对被误报 skipped） | 71/71（新增 `desktop-host` 目标 key） |

## 新增补丁 #89 DESKTOP_HOST_EXIT_AFTER_SHUTDOWN

`dsh-desktop-host` 的 `stop()` 在 `shutdown(0)` + 回话 + `process.disconnect()` 之后**没有 `process.exit()`**，靠事件循环自然结束。装了多个插件后，插件留下的活句柄（推理引擎子进程、WebSocket、定时器、SQLite 连接）让事件循环永远不空转，host 进程不退。

外壳侧 `exitsWithin(exited, 1e4)` 只等 10 秒，超时即 `SIGTERM` 并判「非优雅退出」，抛：

```
desktop update: Host did not complete graceful task teardown
(exit null, signal SIGTERM, shutdown acknowledged true, graceful deadline exceeded true)
```

此时 `install()` 流程中断，`dshPurgeHandoffDesktopUpdate` 一次都不会执行，安装器根本没被调起。

#89 在那两行之后插入 `process.exit(0)`：插件已 dispose 完、外壳已收到确认，三个判据（`exitCode=0` / `shutdownCompleted=true` / `graceful=true`）全部满足，安装继续。

## 新增 targetFiles key：desktop-host

`desktop-shell` 只解析到 `app/lib/main.js` 一个文件，而 #89 的目标在另一个包（`dsh-desktop-host/lib/index.js`）。不给它独立 key，状态判定读不到 markers，会把已打上的补丁误报成 `skipped`。

## 实测

在 0.2.1-rc.3 主机上走通完整应用内更新，升级到 0.2.1-rc.5：

- 升级前：`exit null / signal SIGTERM / graceful deadline exceeded true`
- 升级后：安装器正常调起，宿主版本变为 `0.2.1-rc.5`（buildCommit `d4db512a`）
- 补丁 71/71，0 待应用，`update_phase=active`

## 已知限制

- rc.5 下 `dsh-better-sidebar` 与 `dsh-dream-skin` 停在 pending（`waiting for service: webRuntime`），不影响宿主运行，但侧边栏与皮肤可能不生效。
- 6 条 na 补丁（#28 #30 #31 #64 #65 #76）是目标包本机不装，属正常。

## 安装

```
dsh plugin --profile desktop add file:<path>/dsh-purge-1.3.4.tgz
```
