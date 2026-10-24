# 1.1.72

## 中文

社区兼容包，基于上游 1.1.71 维护，目标宿主 dsh-desktop 0.2.1-rc.3（rc.2 与 0.2.0 仍可用）。

### 本版改动

- 官方「安装新版本」不再被接管：默认只把安装布局归位（app.asar 归位、解包目录改名），然后交还官方更新器；自跑安装器的老路保留为 `DSH_PURGE_UPDATE_HANDOFF=wscript`
- 换包重启时序：换包助手先写就绪标记，宿主等到标记再退出。原先 schtasks 有约 8 秒启动延迟，宿主先退会让外壳误判 host 崩溃，弹出只给「禁用所有第三方插件」的恢复框
- 补丁锚点兜底：#47 / #49 / #57 增加结构型与正则兜底，pi-ai 变量改名、可选链写法均可命中；补上 responses 通路的 developer role 白名单；profile 里 pi-ai 1.3.0 副本的三条补丁补齐
- 移植两组修复：停用/卸载后把 selectedDefault 复位（原 #108），以及 0.2.1 上红队预设的 schema 封口与 toolFilter 清理
- 页面新版本通知：启动后后台查一次版本，有新版时页面右下角提示，开关 `updateCheckOnStart`
- 仓库清理：移除遗留宣传图与旧设计稿，安装包体积下降

### 安装

```
dsh plugin add ./dsh-purge-1.1.72.tgz
```

或解压覆盖 `profile/node_modules/dsh-purge`，然后在面板点一次「应用」。

## English

Community compatibility build on top of 1.1.71. Target host dsh-desktop 0.2.1-rc.3 (rc.2 and 0.2.0 still work).

### Changes

- The official "install new version" button is no longer taken over: only the install layout is normalized (restore app.asar, rename the unpacked dir), then the official updater runs. The self-run installer path stays behind `DSH_PURGE_UPDATE_HANDOFF=wscript`
- Swap restart ordering: the swap helper writes a ready marker first, and the host waits for it before exiting. schtasks takes about 8s to start, which used to make the shell treat the host exit as a crash and show the "disable third-party plugins" recovery dialog
- Patch anchors: #47 / #49 / #57 gained structural and regex fallbacks, so renamed pi-ai variables and optional-chaining forms still match; added the responses-path developer role allowlist; three patches now land on the pi-ai 1.3.0 copy inside the profile
- Ported two fixes: reset selectedDefault on disable/uninstall (upstream #108), and schema sealing plus toolFilter cleanup so the redteam preset loads on 0.2.1
- New-version notice: a background version check runs after boot; when a newer release exists the page shows a corner card. Toggle with `updateCheckOnStart`
- Repository cleanup: removed leftover promo images and old design drafts; the install package got smaller

### Install

```
dsh plugin add ./dsh-purge-1.1.72.tgz
```

Or unzip over `profile/node_modules/dsh-purge`, then press Apply once in the panel.
