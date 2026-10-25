# 1.3

一句话：把 1.2.13–1.2.19 的所有改动合并成 1.3。三件事 —— 官方更新不再被我们拦、换包能自己收尾、runtime 自愈搬到宿主启动之前；另外按第三方安全审计修了六项。

## 改进了什么

**一、官方 in-app 更新恢复正常**
退役补丁 #45。它原来把官方更新协调器的安装调用换成自己的「归位 + quitAndInstall」，绕过官方优雅退出握手，导致每次都报 `Host did not complete graceful task teardown … graceful deadline exceeded true`、安装器一次都不会被调用。现在安装/报错/重启全部交还官方，补丁表 76 → 75。

**二、换包能自己收尾**
以前改名被占用就留下 `app.asar.rename-pending` 然后结束，没有任何角色接手，用户看到「点完应用什么都没发生」。现在 `exit-then-swap`：循环 kill 到进程清零 → 重试改名 20 次 → 删 pending → 写 marker → 先跑 runtime 守卫 → 重新拉起 dsh，日志 `%TEMP%\dsh-purge-exitswap.log`。

**三、runtime 自愈不依赖插件是否被加载**
官方更新偶尔会把 `resources\runtime` 清空，宿主在 `dsh-base` 阶段读 office 技能就崩，而插件是否加载由 `bundles` 决定 —— 插件救不了「自己被摘掉」。新增 `scripts/runtime-guard.ps1` 与 Startup 注册：登录时先补 runtime（判据 `office-skills\office\SKILL.md` + `versions.json`，源为 `assets\runtime-min` 与 `runtime-backup\primary-runtime`）。实测：空 runtime 补 14 个文件、全量恢复 6136 文件 / 257 MB / 13 秒；已有文件不覆盖（预置 CUSTOM 的 `versions.json` 保持原样）；注册表按 `DisplayName -like '*DeepSeek*'` 枚举定位到 `I:\deepseek`。

**四、`bundles` 自愈**
`ensureBundleFirst` 以前遇到「不在列表里」直接 return，现在补回第 0 位；写前写后各 `JSON.parse` 校验。

**五、按安全审计修的六项**

| 项 | 改法 |
|---|---|
| 接口无鉴权 | 非回环 Host 默认 403，新增 `allowLan` 显式开关；单测 6/6（跨站、`Origin:null`、DNS rebinding 形态全拒） |
| 更新无完整性校验 | 默认 ref 钉到发布 tag；下载后校验 `SHA256SUMS`，解压后核对版本，不符即中止 |
| 文档说「不联网」失真 | `INSTALL.md` 改为「运行期不主动外联，只在点更新时访问 GitHub 四个域名」 |
| 5xx 回传异常原文 | 只回 `internal error (see local log)`，细节进本地日志 |
| 解压外部工具绕过条目校验 | 解压前用 `listZipEntries` + `safeZipName` 全量校验，越界名直接拒绝 |
| 自带 node 不可审计 | `VERIFY.md` 补来源与 SHA256 |

## 已知限制

- 官方更新装完由安装器自己拉起 dsh 这一窗口不经过守卫；那种场景靠 `preflight`，前提是 `bundles[0]` 没被破坏。要彻底覆盖得改启动入口或管理员计划任务。
- 守卫按 PowerShell 5.1 写，PowerShell 7 未验；`DSH_HOME` 含非 ASCII 字符时会跳过 Startup 注册（vbs 必须纯 ASCII）。
- 提示词写入接口暂无独立审计日志（审计 V-03），攻击面已由接口鉴权收口。
- 官方的插件兼容性闸门会跳过不兼容的 bundle；被跳过后依赖 `webRuntime` 的插件会 pending，可能导致宿主退出。
- 更新后 `resources\app` 会被整体替换，补丁需要重新点一次「应用」。

## 安装

```powershell
ELECTRON_RUN_AS_NODE=1 "<安装目录>\DeepSeek Harness.exe" "<插件目录>\scripts\postinstall.mjs"
```
