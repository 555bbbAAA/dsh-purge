# 1.3.6

一句话：修好一个会误导人的静默失败，删掉一个点了没反应的按钮，补上一条只在别人机器上才暴露的链路缺口。

## 与上一版本 v1.3.5 的对比

| 维度 | v1.3.5 | v1.3.6 |
|---|---|---|
| 切靶标失败 | `api({ op: 'activateEngagement' }).catch(() => {})` —— 完全静默。下拉框显示已切换，但后端「当前靶标」没改，之后所有技能路径按旧靶标解析，没有任何提示 | 失败写进新增的 `syncWarn` 状态，下拉框右侧显示一行可点关闭的「靶标同步失败：xxx」。**不复用 `err`**，因为 `err` 会把整块 body 换成错误页，一个后台同步失败不该让整个演练台不可用 |
| 演练台「全面浏览」 | 三个入口（面板内按钮、侧栏 ⛶、dock 头按钮）全依赖 `window.open`。Electron 壳的 `setWindowOpenHandler` 无条件 `deny`，且 `window.open` 被拒绝时只返回 `null` 不抛异常，`try/catch` 抓不到 —— 用户看到的是「点了没反应」 | 三个入口连同 `isFullWindow` / `openFull` / `exitFull` / `FullButton` / `.rt-full` 全套 CSS 一起删除，残留检查 0 处 |
| 远程更新带 `runtime-guard.ps1` | 更新只拷 `COPY_NAMES` 白名单里的九项，`scripts/` 不在名单。走远程更新的机器 `ensureRuntimeGuard()` 永远找不到包内脚本，日志写「包内缺 scripts/runtime-guard.ps1，跳过」，第三层自愈对它们永久失效 | 在 `COPY_NAMES` 循环之后单独 `copyFile` 这一个文件。不把 `scripts` 整个加进白名单 —— 那个目录里还有 9 个构建与测试工具运行时用不到，而且 `presets`/`skills` 是用户可能改过的内容，全量同步会覆盖用户定制 |

## 三项改动各自优化了什么

### 1. 切靶标失败提示（唯一对现有用户有实际改善的一项）

**改前的问题不是「没提示」这么简单，是提示缺失导致后续行为错乱却无法归因：**

```
用户切靶标 → 界面显示已切换 → 后端 activateEngagement 失败
→ 后端「当前靶标」仍是旧的 → 原生 skill 目录按旧靶标解析技能根
→ 之后所有技能相关操作都指向错误的靶标 → 用户不知道为什么
```

**改后**：失败当场显示，点掉即消失。

两种失败都覆盖：

```javascript
api({ op: 'activateEngagement', engagement: e.target.value }).then((r) => {
  if (r && r.ok === false) { setSyncWarn((r && r.error) || '同步当前靶标失败'); return }
  setSyncWarn(null)
}, (err) => setSyncWarn(String((err && err.message) || err)))
```

- 后端返回 `{ ok: false, error }` → 显示 `r.error`
- 网络异常 / JSON 解析失败 → 显示 `err.message`

成功时 `setSyncWarn(null)` 清掉旧提示。

### 2. 删除「全面浏览」

**根因不在这个插件里，在桌面壳：**

```javascript
// main.js L6857
view.webContents.setWindowOpenHandler(({ url }) => {
  const destination = new URL(url);
  if (destination.protocol === "https:" && !destination.username && !destination.password)
    shell.openExternal(url).catch(() => {});
  return { action: "deny" };      // 无条件拒绝
});
```

全文件 `action: "allow"` 出现 0 次，12 处 handler 全部 `deny`。

面板地址是 `http://127.0.0.1:<port>`，不是 `https:`，走不到 `openExternal` 分支。

**而 `window.open` 被 deny 时不抛异常，只返回 `null`**，所以原来的 `try { window.open(...) } catch { /* 被浏览器拦截 */ }` 永远不执行 catch，也没有任何提示。

**三个入口的实际位置**（删除前）：

| 入口 | 位置 | 可见条件 |
|---|---|---|
| A 面板内按钮 | `lib/redteam/client.js` → `openFull` | `(full \|\| embedded) ? null : ...` —— dock 里 `embedded: true`，所以**永不显示** |
| B 侧栏 ⛶ | `FullButton` + `redteam-full` 槽位 | 侧栏宽度足够时带文字，否则只有图标 |
| C dock 头按钮 | 根 `client.js` → `requestDrill("full")` | `st.tab === "drill" && readDrillAuth()` —— **这是实际能看到的那一个** |

### 3. 远程更新补 `runtime-guard.ps1`

**这一项对已经装好插件的机器零影响**，因为它只影响「点更新」这条路径，而守卫文件早就独立放在 `<DSH_HOME>\dsh-purge\` 了。

**对走远程更新的新机器影响很大：**

| 机器类型 | 1.3.5 | 1.3.6 |
|---|---|---|
| 完整 `npm install` 装的 | 守卫正常 | 守卫正常 |
| 走远程更新装的 | **第三层自愈永久失效**，日志写「包内缺 scripts/runtime-guard.ps1，跳过」 | 守卫正常部署 |
| 手工摆过守卫的 | 守卫正常 | 守卫正常 |

**为什么只补一个文件而不是整个 `scripts` 目录：**

- `scripts/` 里还有 `build-client.mjs` / `patch-client-dock.mjs` / `selftest.mjs` / `vm-check.ps1` / `vm-verify.ps1` / `redteam-setup.sh` / `postinstall.mjs` / `prelaunch.mjs` / `embed-default-prompt.mjs` 九个构建与测试工具，运行时根本不执行
- `presets/`（`agent.cordis.yml` 27,711 字节）和 `skills/`（23 个文件 135,995 字节）是用户可能改过的内容，全量同步会覆盖用户定制
- 用 `copyFile` 而不是 `cp`：只覆盖这一个文件，不删目录里任何东西

**四个场景的行为测试：**

```
① 全新机器无 scripts 目录    → mkdir + 拷成功
② 已有旧版守卫               → 覆盖成新版
③ scripts 里有其它文件       → build-client.mjs 保持旧版不动，用户自定义.ps1 不被删
④ unpacked 里没有守卫脚本    → 静默跳过，不报错
```

## 这一版验证到的

```
node --check（12 个 js 文件）   ok
import('./lib/index.js')        ok
import('./lib/preflight.js')    ok
重跑 build-client.mjs           前后哈希一致（9A5F3897261F32E1），产物已同步
update.js 四场景行为测试        全过
全面浏览残留检查                四文件 0 处
```

## 已知限制

- rc.5 下 `dsh-better-sidebar` 与 `dsh-dream-skin` 停在 pending（`waiting for service: webRuntime`），不影响宿主运行，但侧边栏与皮肤可能不生效。
- 6 条 na 补丁（#28 #30 #31 #64 #65 #76）都是 `optional: true` 且 `targetFiles` 里对应键全部未映射（liangshen-tool-bootstrap / hooks-claude-code / hooks-codex / preset-unrestricted），走的是 `patchStatus()` 里 `p.optional ? "na" : "missing_file"` 分支，属正常。
- Startup 守卫只覆盖「登录时」这个窗口。官方更新完立刻自动重启那种场景，靠换包链路的 exit-then-swap 在拉起应用前直接跑守卫。非管理员账号建不了 `onlogon` 计划任务（`ERROR: Access is denied.`），所以没有做计划任务。
- 设置页的「继续/重试」配置区仍然不显示。前端组件 `ContinueRetrySection` 存在但调用被注释（`client.js` 里 `// h(ContinueRetrySection, null)`），后端 `/dsh-purge/continue/settings` 端点也从未注册。**这些参数仍可通过 `cordis.patch.yml` 配置**（`autoRetry` / `retryMax` / `autoContinue` / `continueMax` / `continueText` 五项都在），改完重启生效。
- `invalidateUpdateCheckCache` 已导出但无人调用。`GET /dsh-purge/update` 走 30 秒短缓存（实测第一次 2,809 ms、第二次 5 ms），所以 30 秒内连点「检查更新」拿到的是上一次的结果。

## 安装

```
dsh plugin --profile desktop add file:<path>/dsh-purge-1.3.6.tgz
```
