# 1.2.6

一句话：撤掉那条会误报的用户侧提示。

## 与上一版本 v1.2.5 的对比

| 维度 | v1.2.5 | v1.2.6 |
|---|---|---|
| 面板提示 | 只要 `pending` 目录里有 5 分钟内的文件，面板就显示「正在安装更新，请稍候再启动 dsh」 | 撤掉这条提示：正常启动时也可能命中，容易误报成「你正在装更新」 |
| `/status` 字段 | 新增 `update_installing` | 字段保留（仅排查用），界面不再展示 |
| 解包 / 换包 / 更新接管 / 补丁表 | —— | 与 v1.2.5 完全相同，未改动 |

## 已知限制

- 官方更新装完 `electron-updater` 不自动拉起新版本，需要手动启动一次。
- 官方安装器不重写卸载注册表 `DisplayVersion`，判断实际版本请以 `resources\app.asar` 内 `package.json` 为准。
- 更新安装期间手动启动 dsh 仍可能让安装器静默失手（`app.asar` 被重新映射住）——插件侧无法阻止，只能避免自己再抢文件。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
