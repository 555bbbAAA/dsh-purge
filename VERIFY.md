# dsh-purge 验收记录（VERIFY）

本文件记录 2026-10-24 在目标虚拟机上的端到端验收结果、复验命令与故障对照表。
对象：dsh-desktop **0.2.1-rc.3**（Windows），插件 **1.1.9x** 系列。

---

## 一、验收结论

| 要件 | 结论 | 关键证据 |
|---|---|---|
| 在 dsh 0.2.1-rc.2 上装入并跑通 | 通过 | 启动日志 `[boot] enabled=true surface=desktop stripMnemon=true cap=true`；`[http.routes] count=16`；`applied.json` 写入 `host_version=0.2.1-rc.2` |
| 用官方更新器升级 dsh 并重启 | 通过 | 官方安装器把 rc.3 装到 NSIS 默认位置 `%LOCALAPPDATA%\Programs\DeepSeek Harness`，装后 `DeepSeek Harness.exe` 版本 = 0.2.1-rc.3，实例正常起来 |
| 自动识别宿主版本 + 拉远程 + 自动升级插件 | 通过 | 插件 1.1.97 启动时读到宿主 rc.3≠记录 rc.2 → 远端 17 个候选 → 挑 `v1.1.98` → `applied=true` → 两处目录变 1.1.98 → 自动重启（见下方 json 片段） |
| 不崩、不错配 | 通过 | `/dsh-purge/status` = `applied 70/76 · pending 0 · na 6 · asar_still_sealed=false · swap_pending=false`；无新增 `crash-*.log`；密封态换包端到端跑通（apply → 观察者改名 → 自动重启 → 补丁生效） |

自动升级现场记录（`<DSH_HOME>\dsh-purge\auto-upgrade.json`）：

```json
{
  "host_version": "0.2.1-rc.3",
  "host_version_before": "0.2.1-rc.2",
  "plugin_version_before": "1.1.97",
  "applied": true,
  "remote_count": 17,
  "upgraded_to": "1.1.98",
  "tag": "v1.1.98",
  "reason": "host-changed",
  "asar_sealed": false,
  "swap_pending": false,
  "candidate": "1.1.98",
  "plugin_version_after": "1.1.98"
}
```

## 二、三条注脚（验收时的已知边界）

1. **官方更新有一次装出残缺安装**：那次更新器把 rc.3 写进默认位置时 `resources\runtime` 为空，启动崩在
   `ENOENT ... resources\runtime\office-skills\office\SKILL.md`。已从完整安装补齐；属上游增量更新问题，不是插件。
2. **原地 `installer.exe /S --updated` 在该 VM 上 exit 2**（安装态缺/错配卸载注册项时的表现），实际生效的是
   「装到 NSIS 默认位置」这条路径。干净机器上不一定复现。
3. **自动升级只认宿主版本变化**：日常启动只检查并提示（`/status.update` + 面板「新版本」+ `candidate` 字段），
   不会自行安装，避免用户正在工作时被重启。

## 三、复验步骤（命令级）

前置：`<app>` = 默认安装目录 `%LOCALAPPDATA%\Programs\DeepSeek Harness`；`<home>` = `%USERPROFILE%\.dsh`。

1. 看状态

```powershell
# 端口由宿主监听
$pids = (Get-Process -Name "DeepSeek Harness" | Select-Object -ExpandProperty Id)
$port = (Get-NetTCPConnection -State Listen | Where-Object { $pids -contains $_.OwningProcess -and $_.LocalAddress -eq "127.0.0.1" } | Select-Object -First 1).LocalPort
(Invoke-WebRequest "http://127.0.0.1:$port/dsh-purge/status" -UseBasicParsing).Content | ConvertFrom-Json |
  Select-Object plugin_version, patches_applied, patches_total, patches_pending, patches_na, asar_still_sealed, swap_pending, candidate
```

期望：`patches_applied=70`、`patches_pending=0`、`asar_still_sealed=false`。

2. 验「密封态自动换包」

```powershell
$res = Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\resources"
# 恢复密封态（模拟刚被官方更新过）
Move-Item (Join-Path $res "app.asar.bak") (Join-Path $res "app.asar") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $res "app.asar.rename-pending") -Force -ErrorAction SilentlyContinue
# 触发
Invoke-WebRequest "http://127.0.0.1:$port/dsh-purge/apply" -Method POST -Body "{}" -ContentType "application/json" | Out-Null
# 90 秒后应看到：app.asar 消失、app.asar.bak 出现、进程全部换新、sealed=false
Get-ChildItem $res -Filter "app.asar*"
```

3. 验「自动升级插件」

```powershell
# 降一版插件 + 把 host_version 改成旧值，然后重启 dsh，观察 <home>\dsh-purge\auto-upgrade.json
# 期望：applied=true、upgraded_to=<远端最高 tag>、reason=host-changed
$stamp = Join-Path $env:USERPROFILE ".dsh\dsh-purge\applied.json"
Get-Content $stamp -Raw
```

## 四、故障对照表

| 现象 | 原因 | 处理 |
|---|---|---|
| 面板显示 70/76 但 `asar_still_sealed=true`（看似打好实际不生效） | 密封 asar 未被挪走，Electron 仍读归档 | 看 `%TEMP%\dsh-purge-watch.log` 有无 `armed` / `WMI 创建观察者 返回成功`；有 `app.asar.rename-pending` 说明已排上；再确认观察者脚本能被 `powershell -File` 正常解析 |
| `apply` 返回 `swap={"renamed":false,"pending":true}` 之后 asar 一直不动 | 观察者没起来（脚本语法错、被 job object 收掉、进程创建被拒） | 看 `%TEMP%\dsh-purge-asar-rename-idle.log` 是否有 `start pid=`；没有就是没起来。1.1.96 起加了 schtasks 兜底 |
| 官方更新后启动即崩，`ENOENT ... resources\runtime\office-skills\...` | 更新器写出的安装缺 `resources\runtime` | 从完整安装 robocopy 补齐 `resources\runtime`，或用官方安装器重新完整安装 |
| 更新后「还是旧版本」 | 桌面快捷方式/卸载注册项指向的不是更新器落点 | 以 `HKCU\...\Uninstall\*\InstallLocation` 与快捷方式 `TargetPath` 为准，统一到 `%LOCALAPPDATA%\Programs\DeepSeek Harness` |
| 面板数字从 71 变 70 | 补丁表退役 #56（rc.3 重写了 rewind 可见性代码），表 77→76，na 仍 6 | 属预期；`/status` 里看 `patches_total=76` 可确认 |

## 五、证据文件位置

| 内容 | 路径 |
|---|---|
| 插件运行日志 | `%TEMP%\dsh-purge-desktop.log` |
| 打补丁日志 | `%TEMP%\dsh-purge-apply.log` |
| 换包链路（本版新增） | `%TEMP%\dsh-purge-watch.log` |
| 观察者自身日志 | `%TEMP%\dsh-purge-asar-rename-idle.log` |
| 自动升级结果 | `<DSH_HOME>\dsh-purge\auto-upgrade.json` |
| 补丁戳 | `<DSH_HOME>\dsh-purge\applied.json` |
| 宿主崩溃日志 | `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` |
