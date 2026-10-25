# 1.2.7

一句话：把 1.2.7–1.2.12 这几轮合并发布，主题是「状态可判定、启动无窗、红队写入安全」。

## 与上一版本 v1.2.6 的对比

| 维度 | v1.2.6 | v1.2.7 |
|---|---|---|
| `needs_extract` | 依赖 `sealedAsarHandoff()` 取 asar 路径，全新密封安装时返回 null → 恒为 `false`，面板显示成 `0/0 · na 76` | 改为从宿主 `process.execPath` 推 `resources` 目录，只看磁盘事实（`app.asar` 在、`app\package.json` 不在）。实测密封 `true` / 解包后 `false` |
| 开机自愈与「应用」抢写锁 | 自愈先写、用户点的应用被排队到超时，界面只看到「处理中 → 读取失败」 | ①「asar 在 + 解包树也在」时自愈直接跳过（`settle.skip` 记录原因）②`apply` 拿不到锁立刻返回 `busy`：「宿主正在做启动自愈写入，请等 10~30 秒后再点一次」 |
| 换包启动方式 | 换包观察者用 WMI 直接拉 `powershell.exe`，会分配控制台窗口（「第一次点应用弹出一个空白命令行」） | 改为先写 `.vbs`（`sh.Run …, 0, False`）再用 `wscript //B` 拉起；三条启动路径（助手 / watcher / 置顶）现在统一无窗 |
| 诊断日志 | `apply` 入口、`settle` 跳过、`busy` 分支都走 `log(cfg, …)` —— 只在 verbose 打控制台，文件里一条没有 | 全部改走 `purgeLog`，落盘到 `%TEMP%\dsh-purge-desktop.log`：`[apply.enter]`、`[apply.busy]`、`[settle.skip]` |
| 宿主真实版本 | 面板只能显示注册表 `DisplayVersion`（安装器不重写它，永远显示旧版本） | `/status` 新增 `host_version_real`（读宿主 `app\package.json`），侧栏清洗页版本号右边显示「宿主 0.2.1-rc.x」徽标 |
| 应用阶段提示 | 只有一句「处理中…正在解包 / 换包」 | 按 `apply_progress.phase` 分开显示：正在解包（约 40~90 秒）/ 正在写补丁 / 正在换包并重启 |
| 状态字段语义 | `needs_extract` / `initialized` / `pending_reason` 三个字段并存，容易互相矛盾 | `/status` 新增统一结论 `blocked_at`：`none` / `needs_extract` / `needs_swap` / `broken_no_tree` / `unknown`（旧字段保留兼容） |
| 解包标记 | PS1 与进程内两条路径写的时间戳格式不同 | 统一为 `yyyy-MM-ddTHH:mm:ss.fffZ` |
| 红队演练台 B1 | 证据图先落盘再 `INSERT`；`UNIQUE(file)` 撞车会留下孤儿图、甚至覆盖同名旧证据 | 写盘前记下原状，`INSERT` 失败时回滚（原来没有就删、原来有就写回原字节）。单测实测：同名换内容 → 抛 `UNIQUE constraint failed: shot.file` → 文件仍是第一次的 51 字节 |
| 红队演练台 B2 | `schema.js` 每次开库都 `DELETE FROM stage`，用户自建的 stage 会被反复删掉 | 只在 `has('stage','attck')`（确实是旧结构迁移）时清理一次 |
| 红队演练台 B3 | `importBundle` 的 `scan_run` 在 `BEGIN` 之前提交，导入失败会留一条假「已完成」扫描 | 移进事务内 |
| 红队演练台 B4 | 报告里的可执行命令直接拼明文口令 | 口令换成 `<口令:凭据 username>` 占位符，明文只留在凭据表与面板 |

## 这一版验证到的

```
rc.2 全新密封 → 点应用：解包 ✅ → 70 条补丁 ✅ → 换包 ✅（swap.log kill-round×2 → moved-ok）→ 自动重启 ✅
密封态点应用：[apply.enter] op=apply 落盘 ✅ · 无黑框 ✅ · 无「读取失败」 ✅
/status：plugin=1.2.12 · applied=70/76 · sealed=False · host_version_real=0.2.1-rc.3 ✅
红队 addShot：UNIQUE 撞车回滚 ✅（临时靶标单测）
```

## 已知限制

- 官方更新装完 `electron-updater` 不自动拉起新版本，需要手动启动一次。
- 官方安装器不重写卸载注册表 `DisplayVersion`，判断实际版本请以面板上的「宿主」徽标或 `app\package.json` 为准。
- 更新安装期间手动启动 dsh 仍可能让安装器静默失手（`app.asar` 被重新映射住），插件侧无法阻止。
- 「同版本资产指纹更新」通路仍未在真实环境跑过，等下一次「同号换资产」时验。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
