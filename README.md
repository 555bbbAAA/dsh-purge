# dsh-purge

DeepSeek Harness 桌面版的本地兼容层。基于上游 [1.1.71](https://github.com/YuJunZhiXue/dsh-purge) 维护，补齐了 rc.3 之后的全部兼容。

当前版本 **1.3.6** · `dshTarget: >=0.2.1-rc.3 <0.3.0` · MIT

---

## 为什么需要它

DeepSeek Harness 桌面版在自动更新时有两个会让人打不开应用的问题：

**一、更新清空运行时目录。** 官方更新器会把 `resources\runtime` 清掉再装新的。清掉的瞬间如果应用被拉起，`dsh-base` 在加载 `dsh-skill-office` 阶段就 ENOENT 崩了 —— 应用起不来，界面上什么都没有。

**二、装完不退出。** 宿主收到 shutdown 后不真正退出，安装器判定「程序正在运行」而静默 no-op：退出码 0、零写入、无任何弹窗，注册表版本和 `app.asar` 都不变，但 pending 目录里新安装包已经躺好了。看起来像「更新了但没生效」。

这两个问题都不是配置错误，是时序问题。dsh-purge 处理的就是这个时序。

---

## 它做什么

### 运行时自愈（三层）

| 层 | 触发时机 | 能力边界 |
|---|---|---|
| **preflight 插件** | 插件被加载后 | 补 `office-skills` 与 `versions.json`；完整时备份到 `runtime-backup`（约 257 MB）；残缺时整目录恢复；把 `dsh-purge` 提到 bundles 第 0 位 |
| **120 秒 settle** | 插件活下来后 | 二次查相位，处理延迟出现的缺件 |
| **Startup 守卫** | 登录时、宿主启动前 | 不依赖任何插件，直接补 runtime |

前两层有一个绕不过去的死结：插件能不能执行，由 `dsh.profile.bundles` 决定 —— 插件既救不了自己被摘掉，也救不了自己排在 `dsh-base` 之后。所以第三层必须是独立于插件系统的。

### 更新三态

| 相位 | 判据 | 行为 |
|---|---|---|
| `active` | `host_version == applied.json` | 正常工作 |
| `dormant` | 官方安装窗口 | **完全不写文件、不查远端、不起子进程、不排换包** |
| `needs-reapply` | 版本已变 | 安静提示，等用户点应用 |

`dormant` 靠三条本地事实判定：`%TEMP%` 的 official-restarting 标记、`official-restart.log` 段状态、**pending 安装包版本 ≠ 当前宿主版本**（这条能在官方更新器完全不写我们标记的情况下也判出来）。

### 换包链路

```
apply 打完 → renameAsarAside()（改名成功即写 .dshpurge-unpacked）
           → 宿主占用时落回 scheduleExitThenSwap
           → kill → 重试 20 次 → 写 marker → 拉起
```

判断「宿主是否占用」用「能否独占打开 `app.asar`」，不枚举进程。无窗启动一律先写纯 ASCII 的 `.vbs` 再让 `wscript //B` 拉起 —— detached spawn 会忽略 `windowsHide`，`schtasks` 缺 `//B` 会交互，WMI 拉控制台程序必弹窗。

### 其他

- 清洗上游的身份段与拒答面
- 修掉宿主收到 shutdown 后不退出（#89），让「应用内更新」能真正装完并重启
- 面板可查状态：补丁数、相位、宿主版本、换包进度

---

## 兼容性

| 宿主版本 | 状态 |
|---|---|
| 0.2.1-rc.3 | 完整支持。77 条补丁，71 条落地、6 条 na |
| 0.2.1-rc.4 | 与 rc.3 同源，锚点未变 |
| 0.2.1-rc.5 | 逐条核查：49 个补丁目标文件上游一个没改，桌面外壳五条注入结果与 rc.3 逐字节一致；应用内更新从 rc.3 升到 rc.5 实测走通 |

上游 `YuJunZhiXue/dsh-purge`（14.9k stars）声明只支持到 rc.2。本包在其基础上补齐 rc.3 及之后。

那 6 条 na 都是 `optional: true` 且目标文件在上游不存在（`liangshen-tool-bootstrap` / `hooks-claude-code` / `hooks-codex` / `preset-unrestricted`），属正常。

---

## 演练台

插件内置一个攻防演练台，不是独立包。

发送一个靶标单位名称即可拉起红队智能体：内置主会话 + 信息收集 / 资产梳理 / 漏洞发现 / 漏洞利用 / 内网渗透五个执行角色（并发上限 3），资产测绘落入本地 SQLite 资产库，23 个技能文档可自行配置。

入口在 dsh 右侧栏。

双用途内容声明见 [docs/redteam-upstream-DISCLOSURE](docs/redteam-upstream-DISCLOSURE)。

---

## 安装

见 [INSTALL.md](INSTALL.md)。验收记录见 [VERIFY.md](VERIFY.md)。版本变更见 [release-notes.md](release-notes.md)。

---

## 已知限制

- **Startup 守卫只覆盖「登录时」这个窗口。** 官方更新完立刻自动重启那种场景，靠换包链路的 exit-then-swap 在拉起应用前直接跑守卫。非管理员账号建不了 `onlogon` 计划任务（`ERROR: Access is denied.`），所以没做计划任务。
- **设置页的「继续/重试」配置区不显示。** 前端组件存在但调用被注释，后端端点也未注册。这些参数仍可通过 `cordis.patch.yml` 配（`autoRetry` / `retryMax` / `autoContinue` / `continueMax` / `continueText`），改完重启生效。
- **`GET /dsh-purge/update` 走 30 秒短缓存。** 实测第一次 2,809 ms（真去 GitHub 拿 tag 列表）、第二次 5 ms。所以 30 秒内连点「检查更新」拿到的是上一次结果。
- **rc.5 下 `dsh-better-sidebar` 与 `dsh-dream-skin` 停在 pending**（`waiting for service: webRuntime`），不影响宿主运行，但侧边栏与皮肤可能不生效。

---

## 免责

本地开发工具。运行在用户自己的电脑上，修改本机已安装应用的内部文件，不对外提供服务，不联网下载可执行内容。使用后果由使用者承担。
