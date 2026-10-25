# 1.2.5

一句话：把 1.2.5–1.2.14 的所有修复合并成这一版发布，重点是「应用不再报读取失败、换包不再弹黑框、更新链路可判定」。

## 与上一版本 v1.2.4 的对比

| 维度 | v1.2.4 | v1.2.5 |
|---|---|---|
| 点「应用」时的解包 | 同步解包 182MB，宿主事件循环被占满 40–60 秒，`/status` 无响应，界面报「读取失败」 | 解包改异步（每 200 个条目让出事件循环），期间界面稳定显示「处理中…正在解包 / 换包」 |
| 换包助手启动 | 兜底路径 `spawn(powershell, {detached:true, windowsHide:true})` —— detached 会忽略 windowsHide，弹出 `powershell.exe` 黑框；schtasks 的 `/TR` 也缺 `//B` | 三条启动路径（换包助手 / watcher / 窗口置顶助手）全部改为 vbs + `wscript //B`（窗口样式 0），实测无窗 |
| 官方更新接管 | `quitAndInstall(true, true)`（静默）→ 旧进程未退时安装器静默 no-op，重启后版本不变且无提示 | 改 `quitAndInstall(false, true)`；归位后先写一行 `delegate asar=… app=…` 到 `%TEMP%\dsh-purge-official-update.log`，可判定断在哪一步 |
| 换包是否被排上 | 无日志，只能靠猜 | `apply` 外层新增 `[apply] swap check` 与 `[apply] swap result` 两行，任何分支都留痕 |
| 更新进行中误启动 | 用户此时双击 dsh 会把 `app.asar` 重新映射住，安装器静默 no-op | `/status` 新增 `update_installing`，面板提示「正在安装更新，请稍候再启动 dsh（现在启动会打断安装）」 |
| 启动自愈 | —— | 检测到更新进行中只记日志 + 提示，不退出（1.2.12 曾尝试 `process.exit`，会被外壳判成 `dsh desktop host stopped`，已撤） |
| 补丁表 / 安装位 | 76 条补丁、`file:<tarball>` 标准位 | 与 v1.2.4 完全相同，未改动 |

## 这一版实测过的两条链

```
rc.2 全新密封 → 点应用：解包 ✅ → 70 条补丁写入 ✅ → 换包 ✅（asar-swap.log: start→kill×2→moved-ok）
             → 自动重启 → 面板 70/70、sealed=false
dsh 内升级 rc.2 → rc.3：安装器落地 ✅（asar 182,434,783 字节 = rc.3）
             → 再点应用：rc.3 上同样 70/76 ✅
```

## 已知限制

- 官方更新装完 `electron-updater` 不自动拉起新版本，需要手动启动一次。
- 官方安装器不重写卸载注册表 `DisplayVersion`，判断实际版本请以 `resources\app.asar` 内 `package.json` 为准。
- `--repair-baks` 仍按补丁表里的短名拼归档路径（真实包名带 `dsh-` 前缀），映射未修。
- 目标确实已不存在的少数补丁（如 `#24` 的 preset 系列）仍计 `applied`，可用 `target_present=false` 识别。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
