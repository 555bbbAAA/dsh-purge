# 1.2.16

一句话：把 1.2.13–1.2.16 四个版本合并发布。今晚暴露的三个死结一起收口 —— 不再接管官方安装、换包能自己收尾、runtime 自愈搬到宿主启动之前。

## 与上一版本 v1.2.12 的对比

| 维度 | v1.2.12 | v1.2.16 |
|---|---|---|
| in-app 更新（点「更新」） | 补丁 #45 把官方协调器的安装调用换成自己的「归位 + `quitAndInstall`」，绕过官方优雅退出握手；官方 teardown 检查照跑 → `Host did not complete graceful task teardown … graceful deadline exceeded true`，安装器一次都不会被调用 | **#45 退役**（`RETIRED_PATCH_IDS` 加入 45，补丁表 76 → 75）。安装/报错/重启全部交还官方。实测：树里 `main.js` 换回官方原版后，同一个 pending 包一次装成 |
| 换包收尾（asar 让开） | 改名被占用就留下 `app.asar.rename-pending` 然后结束，没有角色接手；用户看到「点完应用什么都没发生」 | 新增 `scheduleExitThenSwap()`：循环 kill 到进程清零 → 重试改名 20 次 → 删 `rename-pending` → 写 `.dshpurge-unpacked` → 重新拉起 dsh；日志 `%TEMP%\dsh-purge-exitswap.log`；启动走 schtasks → WMI(wscript) → spawn(wscript) 三条退路 |
| runtime 被官方更新清空（启动即崩） | 只靠 `preflight`（`inject: []`）在插件加载后自愈 —— 一旦 `dsh-purge` 不在 `bundles[0]`，自愈根本轮不到执行，宿主在 `dsh-base` 阶段就 ENOENT 崩溃 | 新增 **`scripts/runtime-guard.ps1`** 与 Startup 注册：登录时先补 runtime（判据 `runtime\office-skills\office\SKILL.md` + `runtime\versions.json`，源为 `assets\runtime-min` 与 `runtime-backup\primary-runtime`），日志 `%TEMP%\dsh-purge-runtime-guard.log`，**完全不依赖 bundles** |
| runtime 守卫本身的质量 | —— | 1.2.16 修掉三个致命点：①变量名 `$home` 与 PowerShell 只读 `$HOME` 冲突导致补齐源永远找不到（实测 `fail: runtime-min source not found`）②注册表键名写死 `deepseek-harness`（真实是 GUID）→ 改成按 `DisplayName -like '*DeepSeek*'` 枚举 ③`Copy-Item -Force` 会覆盖已有文件 → 改成只补缺失 |
| `bundles` 自愈 | `ensureBundleFirst` 里 `idx <= 0` 直接 return：不在列表就不管，被摘掉后永不自愈 | 改成「不在列表就补到第 0 位、在列表但非首位就提上来」，写前写后各 `JSON.parse` 校验，失败保持原样 |
| 补丁表 | 76 条 | 75 条（#45 退役，定义保留在源码，随时可恢复） |

## 合并进来的四个版本

```
1.2.13  #45 退役（in-app 更新交还官方）
1.2.14  换包收尾 exit-then-swap
1.2.15  runtime 守卫（Startup）+ bundles 缺失自愈
1.2.16  守卫的三处致命修复（$home / 注册表键 / 覆盖策略）
```

## 这一版验证到的

```
#45 退役：树里 main.js 换回官方原版后，同一个 rc.3 安装包一次装成（asar 182,434,783）
换包：手工脚本四步全成功 → 1.2.14 内置；rc.3 上 69/75 写进解包树，sealed true → false
守卫（假安装目录实测）：repair → runtime-min copied files=14 → primary-runtime restored files=6136 → done: ok=True
守卫（真实注册表定位）：ok: runtime complete (I:\deepseek)
守卫覆盖策略：预置 CUSTOM versions.json → 重跑仍是 CUSTOM（只补缺失）
```

## 已知限制

- 守卫挂在登录时启动，覆盖不到「更新完成 → 立刻自动重启、中间没有登录」这种场景；那种场景仍靠 `preflight`（前提是 `bundles[0]` 没被破坏）。
- 官方的插件兼容性闸门（如 0.2.1-rc.3）会跳过不兼容的 bundle；被跳过后依赖 `webRuntime` 的插件会一直 pending，可能导致宿主退出。这类插件需要作者出新版或显式开精确版本豁免。
- 更新后 `resources\app` 会被整体替换，补丁需要重新点一次「应用」。
- 更新安装期间手动启动 dsh 仍可能让安装器失手。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
