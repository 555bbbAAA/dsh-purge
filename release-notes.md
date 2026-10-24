# 1.1.72

社区兼容包，基于上游 1.1.71 维护。目标宿主 dsh-desktop **0.2.1-rc.3**，rc.2 与 0.2.0 仍可用。

## 本版改动

- **官方升级不再被接管**：默认只把安装布局归位（`app.asar` 归位、解包目录改名），随后交还官方更新器。自跑安装器的老路保留为 `DSH_PURGE_UPDATE_HANDOFF=wscript`。
- **换包重启时序**：换包助手先写就绪标记，宿主等到标记再退出。原先 schtasks 约 8 秒启动延迟会让外壳误判 host 崩溃，弹出只给「禁用所有第三方插件」的恢复框。
- **补丁锚点兜底**：#47 / #49 / #57 增加结构型与正则兜底，pi-ai 变量改名、可选链写法均可命中；补上 responses 通路的 developer role 白名单；profile 里 pi-ai 1.3.0 副本的三条补丁补齐。
- **移植两组修复**：停用 / 卸载后复位 `selectedDefault`（原 #108）；0.2.1 上红队预设的 schema 封口与 `toolFilter` 清理。
- **页面新版本通知**：启动后台查一次版本，有新版时页面右下角提示，开关 `updateCheckOnStart`。
- **仓库清理**：移除遗留宣传图与旧设计稿，安装包体积下降。

## 兼容性

| 宿主 | 状态 |
| --- | --- |
| dsh-desktop 0.2.1-rc.3 | 目标版本；npm 侧锚点已预检（原 82 条中 61 条命中；5 条已退役、4 条跳过、1 条属版本演进） |
| dsh-desktop 0.2.1-rc.2 | 兼容 |
| dsh-desktop 0.2.0 | 兼容 |

已知限制：desktop 壳那几条补丁（#45 / #46 / #82 / #83）改的是安装包内的 `app/lib/main.js`，需在 rc.3 上再复核一次。

## 安装

```
dsh plugin add ./dsh-purge-1.1.72.tgz
```

或解压覆盖 `profile/node_modules/dsh-purge`，然后在面板点一次「应用」。

验证：`dsh-purge --status` 应显示「补丁 71/77 已清洗，0 待清洗」（完整表 77 条，其中 71 条在当前布局适用）。

## 文档

- `INSTALL.md` 安装与排障
- `CHANGELOG-LOCAL.md` 本地变更记录

## English

Community compatibility build on top of upstream 1.1.71. Target host dsh-desktop **0.2.1-rc.3**; rc.2 and 0.2.0 still work.

Highlights: the official update button is handed back to the official updater (only the install layout is normalized); the swap helper writes a ready marker so the shell no longer mistakes a host exit for a crash; patch anchors for #47 / #49 / #57 gained structural and regex fallbacks and the responses-path developer role allowlist; two upstream fixes were ported (selectedDefault reset on disable/uninstall, schema sealing plus toolFilter cleanup for 0.2.1); a background version check now shows a corner card when a newer plugin release exists.

Install:

```
dsh plugin add ./dsh-purge-1.1.72.tgz
```

Or unzip over `profile/node_modules/dsh-purge` and press Apply once.

Known limitation: the desktop-shell patches (#45 / #46 / #82 / #83) touch `app/lib/main.js` inside the installer, which still needs a re-check on rc.3.
