# 1.3.5

一句话：把 1.3.0 到 1.3.4 五个版本里一直缺的「运行时守卫自动部署」补回来，并修掉一个把 32 条补丁误报成「无目标」的排查字段 bug。

## 与上一版本 v1.3.4 的对比

| 维度 | v1.3.4 | v1.3.5 |
|---|---|---|
| Startup 守卫部署 | `preflight.js` 里没有部署代码。守卫脚本只在仓库里躺着，`<DSH_HOME>\dsh-purge\runtime-guard.ps1` 与 Startup 里的 `dsh-runtime-guard.vbs` 靠手工摆，换台机器就没有第三层自愈 | 恢复 `ensureRuntimeGuard()`：插件每次启动把包内 `scripts/runtime-guard.ps1` 复制到 `<DSH_HOME>\dsh-purge\`，并在 Startup 写纯 ASCII 的 `dsh-runtime-guard.vbs`。内容没变就不重写 |
| `bundles` 自愈 | `if (idx <= 0) return` —— 插件被从 `dsh.profile.bundles` 里摘掉后永不回来 | 改回「不在列表就补到第 0 位、在列表但非首位就提上来」。官方更新清空 runtime 时，只有排在 `dsh-base` 之前才救得了启动 |
| `target_present` 排查字段 | 直接把 `core.targetFiles()` 的值喂给 `fs.existsSync`。该函数返回的 77 个键里 29 个是**数组**，Node 的 `fs.existsSync(数组)` 返回 `false` 而不抛异常，于是 32 条补丁被误判成「目标不存在」 | 先归一成数组再逐个判。77 条重跑后 `target_present=false` 从 32 条降到 0 |
| 卸载清理 | 不清 Startup 项与部署的 ps1。卸载后每次登录 `wscript` 弹「找不到文件」错误框 | `uninstallPurge()` 新增 `removeRuntimeGuard()`：删 `<DSH_HOME>\dsh-purge\runtime-guard.ps1` 与 Startup 的 vbs；保留 `applied.json` / `runtime-backup` / `asset-fingerprint.json` 等状态文件，重装还能用 |
| 换包重启前跑守卫 | `ASAR_SWAP_PS1` 里只有一句 `if ($DshHome) { ... }`，但 `$DshHome` **从来没被注入过**，恒为空 —— 那句一直是死代码。注释声称「换包那条路径改由 exit-then-swap 在拉起应用前直接跑守卫」，实际 grep `guard` 为空 | 注入 `$DshHome`（`resolveDshHomeForScript()` 从环境变量或 `findDshHome()` 推断），并在 `Start-Process -FilePath $ExePath` 之前调一次 `runtime-guard.ps1`。守卫自判「文件在不在」，不缺 211ms 退出，不拖慢启动 |
| 换包前守卫的硬超时 | 直接 `& powershell.exe -File $guardPs1` 调用。守卫若卡住（安全软件拦截 / 磁盘 IO 挂起），换包脚本会无限等，应用永远拉不起来 | 改用 `Start-Process -PassThru` + `Wait-Process -Timeout 10`。正常 0.38 秒返回，超时则 `Stop-Process` 杀掉并继续拉起。实测：造 `Start-Sleep 30` 的假守卫，总耗时 10.2 秒后正常放行 |
| 部署副本不覆盖 | `ensureRuntimeGuard()` 按内容比对后覆盖目标。用户手工摆的部署副本（比如抬头标了别的版本号）会被自动覆盖掉，失去手工控制权 | 改成「只在目标不存在时写」。已存在就保留并记一行日志；用户删掉后下次启动自动补上。实测三个场景：不存在→部署、已存在→保留原文、删掉→重建 |

## 恢复的 53 行是怎么丢的

`lib/preflight.js` 的完整提交史只有五个 commit：

```
ee7883e0  2026-10-24 21:14  1.2.0   汇总 1.1.81-1.1.125
d3b3145f  2026-10-24 22:31  1.2.2   修 apply_progress 卡死
ba7d4ef3  2026-10-25 15:41  1.2.16  新增 ensureRuntimeGuard（+104 行）
974245a2  2026-10-25 16:00  1.3     保留，加 4 行注释
04df43ea  2026-10-25 19:42  chore: sync tree to v1.3   ← -53 +3，把它删了
```

那次 `chore: sync tree to v1.3` 是 19:41–19:49 连着 100 个批量同步提交之一，用本机旧目录覆盖了仓库。同一个 commit 还把 `ensureBundleFirst` 的「被摘掉就补回第 0 位」回退成 `if (idx <= 0) return`。

**因为回退发生在 `v1.3` tag 之后，1.3 / 1.3.1 / 1.3.2 / 1.3.3 / 1.3.4 五个版本都带着这个缺口。** 1.3.5 把它们一起补回来。

## 32 条误判的补丁

`target_present` 只用于排查显示，不参与状态判定（`patch_status` 按文件内容判定，是唯一权威），所以这个 bug 不影响功能，只影响排查时看到的信息。涉及：

```
#13 #14 #22 #24 #33 #34 #35 #36 #37 #38 #39 #43 #48 #50 #51 #52 #54 #55
#58 #59 #60 #61 #62 #67 #68 #69 #72 #74 #75 #78 #87 #88
```

样本验证 #67 `AGENT_LOOP_MESSAGES_GUARD`：目标文件 `dsh-agent-loop/lib/index.js` 存在（76,011 字节），marker `[dsh-purge] guard undefined messages` 在文件里，原始 needle 不在 —— 补丁确实打上了，只是字段报错了。

## 这一版验证到的

```
node --check lib/index.js       ok
node --check lib/core.js        ok
node --check lib/reapply.js     ok
node --check lib/preflight.js   ok
node --check lib/uninstall.js   ok
import('./lib/index.js')        ok

ensureBundleFirst 行为测试：bundles 里没有 dsh-purge → 改后补回第 0 位
removeRuntimeGuard 行为测试：删 ps1 + vbs，保留 applied.json；第二次执行幂等，不抛异常
target_present 新逻辑：77 条补丁全部 true，误判 0 条
换包脚本语法：抽 ASAR_SWAP_PS1 拼成真实脚本（97 条目 / 5,664 字节），PowerShell 解析器无错误
换包脚本行为：守卫段在 Start-Process 之前，造临时 DSH_HOME 实测守卫被真正调用
超时兜底：造 Start-Sleep 30 的假守卫 → 10.2 秒后放行；正常守卫 0.38 秒返回
不覆盖：目标不存在→部署；已存在→保留原文；删掉→重建
```

## 已知限制

- rc.5 下 `dsh-better-sidebar` 与 `dsh-dream-skin` 停在 pending（`waiting for service: webRuntime`），不影响宿主运行，但侧边栏与皮肤可能不生效。
- 6 条 na 补丁（#28 #30 #31 #64 #65 #76）都是 `optional: true` 且 `targetFiles` 里对应键全部未映射（liangshen-tool-bootstrap / hooks-claude-code / hooks-codex / preset-unrestricted），走的是 `patchStatus()` 里 `p.optional ? "na" : "missing_file"` 分支，属正常。
- Startup 守卫只覆盖「登录时」这个窗口。官方更新完立刻自动重启那种场景，靠换包链路的 exit-then-swap 在拉起应用前直接跑守卫。非管理员账号建不了 `onlogon` 计划任务（`ERROR: Access is denied.`），所以没有做计划任务。

## 安装

```
dsh plugin --profile desktop add file:<path>/dsh-purge-1.3.5.tgz
```
