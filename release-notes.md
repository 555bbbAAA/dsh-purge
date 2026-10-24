# 1.2

一句话：把 1.1.81–1.1.125 的全部修复收进一个版本号，重点是「官方更新之后还能正常用」。

## 与 1.1.71c 的对比

| 维度 | 1.1.71c | 1.2 |
|---|---|---|
| 换包（让补丁真正生效） | 依赖外部进程排队改名，常常静默不动 | `apply` 恢复调用 `scheduleSealedDesktopRestart`；先走 `renameAsarAside`，占用时回落 watcher/PS1，成功后必写 `.dshpurge-unpacked` |
| 全新密封安装点「应用」 | 第一次常什么都不写（旧戳误判「已解包」） | 解包树不存在时强制重解包，一次点完（实测 70/76 · `sealed=false`） |
| `resources\runtime` 被官方更新清空 | 启动即崩，只能手工 robocopy 抢修 | 新增零依赖 `preflight`：缺件用包内 23KB 最小集补齐、完整时备份 257MB、残缺时整目录恢复；压测清空后自动 `restore 6136 文件`，无崩溃 |
| 状态口径 | 面板只给一个数字，打没打看不出来 | `needs_extract` / `initialized` / `apply_progress` / `patch_counts` / 每条 `target_present`；计数以文件内容为准 |
| 误报「补丁已丢失」 | 重装或回退后必现 | 未初始化不算丢；回退写 `last-revert.json`，30 分钟内抑制，另给 `revert_incomplete` |
| 换包时弹黑框 | 有 | 观察者与换包助手都改 `wscript //nologo x.vbs`（窗口样式 0），实测无窗 |
| 插件自身副作用 | 会在桌面/开始菜单投「换包」快捷方式 | 不再投放；preflight 每次启动清旧备份，只留最新 1 个 |
| 升级方式 | 只认自家 tag | 同左；只装 release 里的 tag，`master` 装不上 |
| 自动更新 | 无 | **宿主 dsh 版本一变就自升级**：启动时先取一份宿主版本快照，和 `applied.json` 里记录的比；变了就从 GitHub 拉最新 tag → 校验 → 装进 profile 与 `.dsh/plugins` 两处 → 回写版本戳 → 自动重启。远端列表为空时不写戳（避免永久放弃），版本比较按段数值取最高 |

## 已知限制

- 官方更新装完 `electron-updater` 不自动重启新版本，需要手动启动一次；插件在宿主内部拉不起来。
- `--repair-baks` 仍按补丁表里的短名拼归档路径（真实包名带 `dsh-` 前缀），映射未修。
- 目标确实已不存在的少数补丁（如 `#24` 的 preset 系列）仍计 `applied`，可用 `target_present=false` 识别。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```

## 自动更新怎么工作（1.2 保留并加固）

1. 启动瞬间取宿主版本快照（在自愈改写戳之前），与 `applied.json` 的 `host_version` 比对
2. 版本变化 → 用 `tags.atom` / `releases.atom` + GitHub API 合并取 tag 列表（API 403 / raw 超时 / jsDelivr 500 都实测过，atom 最稳）
3. `pickNewestTag()` 按段数值降序取最高版本；本地已最新则不动
4. 安装到两处目录，回写 `host_version`，记 `auto-upgrade.json`（含 `reason` / `candidate` / `plugin_version_before`），然后自动重启
5. 开关：`autoUpdatePluginOnHostChange`（默认开）、`autoUpdateOnStart`（默认关）、`autoApplyOnStart`（默认开）
6. 版本 tag 允许两段（`v1.2`）与三段（`v1.2.0`）：1.2 之前只认三段，自家发的 `v1.2` 会被 `isInstallableTag` 拒掉，自动更新永远看不到它

## 仍在 v1.2 内的后续改动（2026-10-25）

- 入口标准化：左侧侧栏一项 `dsh-purge`（`sidebar.panellist` + `main`），删除右下角浮动按钮、标签栏按钮、首屏挂件与更新浮层。
- 清洗页改为**页面内嵌**（整块 UI 渲染在插件页里，不再弹窗）；演练台仍走旧浮动面板，入口为页面右上角主色按钮「⚑ 演练台 ↗」。
- 安装位标准化：`profiles/<profile>/node_modules/<pkg>` 改为真实目录，依赖写 `file:<tarball>`（不再用 Junction 指向源码目录）；tarball 由 `npm pack` 产出。
- 演练台按钮/页签尺寸统一（min-height 30px、等宽页签、工具条间距 8）。
