# 1.2

把 1.1.81 到 1.1.125 之间的全部改动收进一个正式版本号发布，并附上这一路修掉的 bug。

## 这一版修了什么

### 换包（让补丁真正生效）
- **「应用」自 1.1.111 起根本没在换包**：那段被换成了 `needs-postinstall` 占位，于是补丁写完就结束、`app.asar` 一直不动、状态长期 `sealed=True`。现在恢复调用 `scheduleSealedDesktopRestart`：先直接试 `renameAsarAside`（唯一咽喉点，成功即写标记），宿主占用时落回 watcher/PS1。
- **换包成功后不写 `.dshpurge-unpacked`**：写标记下沉到 `extract-asar.renameAsarAside`，PS1 换包脚本也在 `moved-ok` 之后补写。自愈逻辑不会再按「asar 不在」把归档装回来、把解包树改名成 `app.dshpurge-prev`。
- **全新密封安装第一次点应用什么都不写**：旧 `unpacked-asar.json` 戳让 `shouldExtractAsar` 误判「已经解过」，于是 64 条补丁全记 pending。现在解包树不存在时强制 `upgrade: true` 重新解包。
- **换包弹黑框**：schtasks 直接跑 powershell 时任务计划会先分配控制台窗口，`-WindowStyle Hidden` 只是「窗口起来后再藏」。观察者与换包助手都改成 `wscript //nologo x.vbs`（`sh.Run cmd, 0, False`），实测无窗。
- **postinstall 同进程改名 EBUSY**：刚解包完立刻改名会锁住自己，改成 `--rename-only` 子进程执行，实测 0 秒成功。

### runtime 自愈（官方更新常把 `resources\runtime` 清空，启动即崩）
- 新增 `lib/preflight.js`（插件 id `dsh-purge-preflight`，`inject: []` 零依赖）：缺 `office-skills\office\SKILL.md` 等启动必需项时用包内 `assets/runtime-min`（23KB）补齐；runtime 完整且未备份时备份到 `<DSH_HOME>\dsh-purge\runtime-backup`；残缺且有备份时整目录恢复。
- preflight 会把本插件在 profile `dsh.profile.bundles` 里提到**最前**（写盘无 BOM、写前后各 JSON 校验）。必须最前：`resources\runtime` 是 dsh-base 加载 `dsh-skill-office` 时就读的，排在后面崩溃已经发生、自救轮不到执行。
- 压测：把 `resources\runtime` 整个改名后直接启动 → `repair patched=14` + `restore 6136 文件`，5 进程存活、无崩溃。

### 状态与计数口径
- `/status` 新增 `needs_extract` 与 `initialized`：区分「未初始化」与「真的没补丁可打」，不再把全新安装显示成 `0/0 · na 76`。
- 修「全新安装 / 回退后误报『补丁已丢失』」：`applied.json` 跨重装保留会让旧戳骗过判据；回退现在写 `last-revert.json`，30 分钟内抑制 `patches_lost`，并单列 `revert_incomplete`。
- 计数口径定稿：对外数字一律用 core 的 `patch_status`（按文件内容判定，唯一权威）；每条补丁附 `target_present` 作为排查提示，但不用它篡改计数（曾因覆盖导致面板从 70/76 掉到 35/76）。

### 其他
- `apply` 不再向桌面/开始菜单投放「dsh-purge 换包」快捷方式（1.1.109 那版遗留）。
- preflight 每次启动清理 `.dsh\plugins` 与 `profile\node_modules` 下的 `dsh-purge.bak-*` / `dsh-purge.rc3-*`，只保留最新 1 个。
- `/status` 新增 `apply_progress`（`extracting` / `patching` / `swapping` + `elapsed_ms`），解包 60–90 秒期间不再是黑盒。
- preflight 定位宿主改用 `process.execPath`（插件跑在宿主进程里），备份检索支持跨账号；不再用 `USERPROFILE` 猜。

## 已知限制

- 官方更新装完 `electron-updater` 不会自动重启新版本（进程数为 0），需要手动启动一次；插件侧无法从宿主内部拉起。
- `--repair-baks` 目前按补丁表里的短名拼归档路径，真实包名带 `dsh-` 前缀，映射未修，因此实际可重建数为 0。
- 目标文件确实已不存在的少数补丁（例如 `#24` 的 preset 系列）仍会被计为 `applied`，可用 `target_present=false` 识别。

## 安装

```powershell
# 解压到 profile 的插件目录后，用宿主自带 Electron 跑一次安装后处理
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
