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
| 升级方式 | 只认自家 tag | 同左；宿主版本变化时自动拉最新 tag 升级 |

## 已知限制

- 官方更新装完 `electron-updater` 不自动重启新版本，需要手动启动一次；插件在宿主内部拉不起来。
- `--repair-baks` 仍按补丁表里的短名拼归档路径（真实包名带 `dsh-` 前缀），映射未修。
- 目标确实已不存在的少数补丁（如 `#24` 的 preset 系列）仍计 `applied`，可用 `target_present=false` 识别。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
