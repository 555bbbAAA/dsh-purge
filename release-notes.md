# 1.3.9

一句话：修「红队模式在新版 dsh 上加载失败」。两处，一处在我们发的包里，一处只在老机器的部署副本上 —— 宿主 0.2.2 把 `list_agents` 并入 `dsh-tool-subagent-control` 主入口（`./list-agents` 子路径删除），又把 `toolFilter` 变成「键存在就抛」，于是老预设一挂载就整份注册失败，红队模式在选择器里消失。

## 与上一版本 v1.3.8 的对比

| 维度 | v1.3.8 | v1.3.9 |
|---|---|---|
| 补丁总数 | 73 | 73（不变） |
| 0.2.1-rc.5 | 71 applied / 6 na | 71 applied / 6 na（不变） |
| 0.2.2-rc.1 | 71 applied / 2 na | 71 applied / 2 na（不变） |
| 预设里的 `.../list-agents` 行 | 还在，0.2.2 上 `never started` | 已删 |
| 老机器部署副本里的死行 | 不处理 | 启动时自愈摘掉 |
| 派活约束段的重复行 | 每轮可能多插一遍 | 已判重，只留一份 |
| 红队模式在 0.2.2 上 | `registered-broken` | 正常注册 |

改了三个文件：`presets/redteam/agent.cordis.yml`（删一行）、`lib/redteam/index.js`（自愈 + 判重）、`package.json`（版本）。补丁表、锚点、计数一律未动。

## 缺陷一：预设里还留着 0.2.2 已删的子路径行

`presets/redteam/agent.cordis.yml` 里原本有这一段：

```yaml
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
      disabled: false
```

0.2.2-rc.1 的 `@deepseek-ai/dsh-tool-subagent-control` 只导出四个入口：

```
"."  "./src/*"  "./package.json"  "./locale/*.json"
```

`list_agents` 已经并进主入口 —— `lib/index.js` 的 `apply(ctx)` 里第 155 行直接 `registerListAgents(ctx)`。所以那条子路径解析直接失败：

```
ERROR  Package subpath './list-agents' is not defined by "exports" in
       .../dsh-tool-subagent-control/package.json
       code: ERR_PACKAGE_PATH_NOT_EXPORTED
```

后果不是少了 `list_agents` 一个工具，而是**那一行 never started → 整个预设被判 `registered-broken`**，`$DSH_HOME/redteam/preset-declare.json` 里能看到明细：

```json
{ "ok": false, "phase": "registered-broken", "plugins": 19,
  "broken": "tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started" }
```

19 行里 18 行正常，就这一行挂着。修法是把这三行删掉；不能改成指向该包主入口 —— 同一个包注册两次会撞 provider 已注册。

## 缺陷二：老机器上的部署副本不会被刷新

`installPreset()` 在已有 `agent.cordis.yml` 时走自愈分支而不是覆盖（保留用户改动），原来的自愈只处理四件事：技能目录占位符、工具包名、`toolFilter`、`disabled: true`。

但 `toolFilter` 那段文本是 1.1.31 时代的产物 —— 那时候预设里有：

```yaml
        toolFilter:
          deny:
            - subagent_fork
            - workflow
            - ralph
```

宿主从 0.2.1-rc.2 起对这两个字段是**键存在就抛**：

```js
for (const field of ["persona", "toolFilter"])
  if (Object.hasOwn(config, field)) throw new Error(`tool-subagent: ${field} is no longer supported; …`)
```

于是老机器升级到 0.2.2 后，客户端报的是「该预设里的 toolFilter 已被新版 dsh 移除」，红队模式同样加载不出来 —— 和我们包里那份干净的文件无关，问题在**用户机器上那份从安装当天就没再变的副本**。

1.3.9 补三件事：

1. 自愈新增 `stripDeadSubagentRows()`：把 `name` 指向 `@deepseek-ai/dsh-tool-subagent-control/<子路径>` 的行整块摘掉。只认「这一行自己的 `name` 字段」（id 行之后第一条非空行），组行不会把整棵子树吞掉；摘完幂等，第二次跑 `changed = false`。
2. `stripToolFilter()` 原来的判据是「`toolFilter:` 后面只剩空白或注释」，`toolFilter: { deny: [...] }` 与 `toolFilter: null` 这种同行写法会漏过去 —— 宿主照样抛错。现在放宽到「冒号后面有什么都算」，三种写法都摘。
3. `repairDelegation()` 的「必须用原生 subagent 派活」那段改成**转义与非转义两种形态都算已存在**，避免模板里写的是 `` \` `` 而判重看的是普通反引号，每轮都多插一遍。

## 验证

四个案例，用真代码跑 `installPreset()`：

| 案例 | 输入 | 期望 | 实测 |
|---|---|---|---|
| 1 | 老副本（带 `toolFilter` + `list-agents` 行） | 两处都修掉，其余保留 | `repaired = toolFilter+drop-dead-subagent-row+delegation`，`delegation` / `tool-subagent-control` / `tool-subagent` / `maxDepth: 1` 全在 |
| 2 | 紧接着再跑一次 | 幂等 | `action = kept`，文本逐字节不变 |
| 3 | 空目录（全新安装） | 落地新预设 | 386 行，`list-agents` 0 处，`delegation` 在 |
| 4 | 真实已部署目录 | 不动或只修该修的 | 修完后 `list-agents` 0 处 |

## 已知限制

- 已部署副本只在**插件加载时**自愈，改完要重启 dsh 才生效；跑着的进程里还是旧预设。
- 用户手工改过的预设不会被整份覆盖 —— 这是有意的（改一次就被冲掉更烦），代价是自愈只能覆盖**已知的那几类**漂移；将来 dsh 再改包入口，这里还要跟着加一条。
- `list_agents` 在 0.2.1 及更早是独立子路径、在 0.2.2 并入主入口；本版按「子路径一律摘掉」处理，两代宿主上都对（0.2.1 上主入口本来也带 `list_agents`）。

# 1.3.8

一句话：修「插件内更新完点重启，dsh 没重启」—— 三处缺陷叠加在一条启动链上：vbs 无 BOM 在中文用户名下路径乱码、vbs 引号多包一层让 VBScript 报「语句未结束」、plus 助手未就绪时宿主照样退出。三个全修，换包这条链才通。

## 与上一版本 v1.3.7 的对比

| 维度 | v1.3.7 | v1.3.8 |
|---|---|---|
| 补丁总数 | 73 | 73（不变） |
| 0.2.1-rc.5 | 71 applied / 6 na | 71 applied / 6 na（不变） |
| 0.2.2-rc.1 | 71 applied / 2 na | 71 applied / 2 na（不变） |
| 观察者 vbs 编码 | UTF-8 无 BOM，中文路径乱码 | UTF-16LE + BOM |
| 观察者 vbs 引号 | `sh.Run ""C:\...`，语法错 | `Chr(34)` 拼 `cmdLine`，正常启动 |
| 助手未就绪 | 宿主照样退出 | 先重试，仍不成则保持运行并录失败标记 |
| `release-notes.md` | 不在安装清单里 | 随更新一起覆盖 |

改了三个文件：`lib/desktop.js`、`lib/restart-desktop.js`、`lib/update.js`；另动 `package.json`（版本 + `files` 补 `release-notes.md`）与 `README.md`（版本串）。补丁表、锚点、计数一律未动。

## 缺陷一：vbs 启动器无 BOM，中文用户名下路径乱码

原来写 `.vbs` 用的是：

```js
fs.writeFileSync(vbs, body, "utf8");   // 没有 BOM
```

WSH 读**无 BOM 的 `.vbs` 时按系统 ANSI（中文机是 GBK）解码**。用户名是「张」时，UTF-8 字节被 GBK 读成「寮燶」，于是脚本里那行变成：

```
-File "C:\Users\寮燶AppData\Local\Temp\dsh-purge-asar-swap-36640.ps1"
```

PowerShell 找不到那个脚本，直接退出。助手从没跑起来，而调用方只看到 `ready=false`。

**2x2 实测矩阵**（四组路径全都含「张」）：

| ps1 BOM | vbs BOM | 结果 |
|---|---|---|
| ✗ | ✗ | 失败 |
| ✓ | ✗ | 失败 |
| ✗ | ✓ | 失败 |
| ✓ | ✓ | **成功** |

两个都必须带 BOM 才行。修法：新增 `writeWshVbs()` 统一写 UTF-16LE + BOM，五个 `.vbs` 写入点全部改走它；四个 `.ps1` 写入点补 `\uFEFF` 前缀。

## 缺陷二：vbs 引号多包了一层，观察者启动即死

这一处比缺陷一更隐蔽 —— 它让整条换包链断在第一步。

`scheduleAsarRenameWhenIdle` 里给观察者写启动器，原来是这样：

```js
const quote = (v) => String(v).replace(/"/g, '""');
const pieces = [psExe, ...watchArgs].map((a) => `"${quote(a)}"`);
// pieces 里每一项已经带引号了
`sh.Run "${pieces.join(" ")}", 0, False`
// 再整体套一层 → 生成 sh.Run ""C:\...powershell.exe" ...
```

VBScript 看到 `sh.Run ""` 会把 `""` 当成转义引号，紧接着的裸路径就成了非法 token。实测报错：

```
cscript: ...dsh-purge-asar-watch-18876-1609a3c2.vbs(4, 10)
         Microsoft VBScript 编译器错误: 语句未结束
```

于是 `wscript.exe //B` 一启动就退出，观察者进程从没存在过 —— 支撑证据：`dsh-purge-asar-rename-idle.log` 不存在、没有 `wscript`/`powershell` 进程、`app.asar` 213,202,918 B 原封不动、`rename-pending` 停在 00:17:36。宿主在等一个永远不会来的信号。

**这个 bug 在 1.3.7 里就有**（那份 `desktop.js:1431` 同样的写法），不是本版引入的。缺陷一把 vbs 变成乱码，语法错被更早的错误盖住，所以它一直没露出来 —— 只修缺陷一，现象完全不变。

修法：改成跟 `spawnHelper`、换包启动器那两处一致的写法，用 `Chr(34)` 拼 `cmdLine`，再 `sh.Run cmdLine, 0, False`：

```js
const cmdParts = [psExe, ...watchArgs].map((a) => `Chr(34) & "${quote(a)}" & Chr(34)`);
`cmdLine = ${cmdParts.join(' & " " & ')}`
```

## 缺陷三：助手未就绪时宿主照样退出

原来：

```js
waitForReady(readyMarker, budget).then((ready) => {
  logInternal("asar swap: helper ready=" + ready);
  gracefulExit();          // ← ready 为 false 也退
});
```

「助手已起来 → 退出让它接管」和「助手没起来 → 退出就是把自己关了没人管」是**相反**的两件事，代码里却走了同一条路。实测后果：宿主退出、Electron 没被杀、`app.asar` 没改名、也没人 relaunch。用户看到的是「点了重启，dsh 没了」，日志只平静地写一句 `ready=false`。

修法：`ready=true` → 照旧 `gracefulExit()`；`ready=false` → 重试启动一次，仍不成则**保持运行**、把失败写进 `<dshHome>/dsh-purge/swap-restart-failed.json` 供 `/status` 读取。

## 顺手补的：发行说明不进安装清单

`package.json` 的 `files` 和 `lib/update.js` 的 `COPY_NAMES` 都没有 `release-notes.md`，所以插件内更新永远不覆盖它 —— 装上新版的机器上，`release-notes.md` 还停在 1.3.6。两处都补上。

## 验证

| 项 | 结果 |
|---|---|
| 九个入口 `node --check` | 全 OK |
| `scripts/selftest.mjs` | 17/17 通过 |
| 2x2 BOM 矩阵 | 只有 ps1 ✓ + vbs ✓ 那格成功 |
| `writeWshVbs` 产出字节 | UTF-16LE BOM `FF FE`，解出路径含「张」完好 |
| 修复后 vbs 语法 | `cscript` 无报错 |
| 修复后 vbs 真跑 | `wscript //B` 启动，写盘验证通过 |
| 真实 11 个参数传参 | 参数含空格路径全部原样到达 PowerShell |
| 补丁表 | 73 条未动，0.2.2-rc.1 上仍 71 applied / 2 na |

## 已知限制

- 这只修「重启」这一步。如果宿主当前已经卡在 `needs_swap`（`app.asar` 没改名、`app.asar.rename-pending` 还在），装好之后仍需再点一次应用或重启把换包走完。
- 路径含非 ASCII 的其他场景（比如 Startup 守卫的 `dsh-runtime-guard.vbs`）走的是另一条 ASCII 校验分支，本次未改。
---



# 1.3.7

一句话：把补丁表对上 0.2.2-rc.1 —— 12 条失效里 8 条换了新锚点、4 条退役，同时保持 0.2.1 整条线原样可用。

## 与上一版本 v1.3.6 的对比

| 维度 | v1.3.6 | v1.3.7 |
|---|---|---|
| 补丁总数 | 77（6 条 na） | 73（退役 4 条） |
| 0.2.1-rc.5 | 71 applied / 6 na | 71 applied / 6 na（不变） |
| 0.2.2-rc.1 | 12 条打不上 | 全绿，0 条失效 |
| `targetFiles()` key | 52 | 55（新增 3 个） |
| `dshTarget` | `>=0.2.1-0 <0.3.0` | 不变 |

## 12 条失效的处置

### 8 条换锚点（语义不变，只是上游改了写法或搬了家）

| 补丁 | 上游变化 | 做法 |
|---|---|---|
| #12 APPROVAL_ASK_SENTENCE_BYPASS | ask 句前半截改成「Approval prompts are enabled in this session:」 | 两条 pattern 并存，0.2.1 走旧、0.2.2 走新 |
| #14 ESCALATION_GRANT_UNCONDITIONAL | `displayReason` 从内联 `{en,zh}` 抽成 `escalationDisplayReason(mode, justification)` | 新增一条 pattern |
| #40 COMPLETE_PROMPT_KEEP_INJECT | assemble 的两个 return 分支都多带一个 `tools` 字段 | 新增正则 pattern，保留 `tools` 透传 |
| #54 DELIVERABLE_DO_NOT | 整段 prompt 从 `dsh-client-ui-deliverables` 搬到新包 `dsh-deliverable-file-references` | 新增 targetFiles key，两个 key 一起覆盖 |
| #60 OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL | PTC 执行器从 `dsh-tools` 拆成独立包 `dsh-tool-executor-ptc` | 新增 targetFiles key，三条 key 一起覆盖 |
| #62 OFFICIAL_TOOL_ASK_FAILOPEN | `serviceAsk` 逻辑从 `lib/types/index.js` 挪到 `lib/types/pipeline.js` | 新增 targetFiles key |
| #67 AGENT_LOOP_MESSAGES_GUARD | 上游包了一层 try，缩进 4 tab → 5 tab | 两条 pattern 并存 |
| #74 ASSEMBLE_BEFORE_PRESTEP | pre-step 重排：`inbox.claim` 之后插了 `model.current()` / `tools.resolve()`，assemble 进 try 块 | 插入点改到 claim 之后，更早也更稳 |

### 4 条退役

`#30` / `#31` / `#64` / `#65` 的目标包 `dsh-hooks-claude-code` 与 `dsh-hooks-codex` 在 0.2.2-rc.1 里**整个消失**（安装包、asar 清单、解包树三处都查过，零文件）。上游自己取消了这块攻击面，没有可清洗的对象。定义留源码，不参与应用与计数。

## 顺手修的两处

### #17 FS_OBSERVATION_INTENT_FREE

0.2.2 把 `editIntent` 的读前校验抽成 `requirePresent()`，并新增 `deleteIntent` 复用同一套判据。v1.3.6 只放行了 `writeIntent`，编辑和删除在 0.2.2 上仍被读前门挡。1.3.7 补齐三个入口加本体兜底，四条 pattern 全放行。

### 退役后的幽灵键

`hooks-deny.js` 的 `annotateHookDenyStatus` 会无条件遍历 `HOOK_DENY_PATCH_IDS` 写 status。四条退役后 status 里没有它们的键，继续写会凭空造出四个幽灵键，面板计数多出四行。加一行 `if (prev === undefined) continue;`。

## 实战补丁：#82 在 0.2.2 上失效

真机（VM，0.2.2-rc.1）验证时发现 `#82 DESKTOP_SHELL_PROFILE_FALLBACK` 是 `skipped`，不是预期。

**真因**：0.2.2 重新切了 bundle，`main.js` 里这两行不再相邻 ——

```
import { REMOTE_STREAM_MUX_PATH, ... } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
//#region ../../node_modules/.pnpm/mime@4.1.1/node_modules/mime/dist/types/other.js   ← 0.2.2 插进来的
//#region ../../packages/util/home-paths/lib/index.js
```

**定量证据**：本地把 pristine 0.2.2 的 `main.js` 打完五条桌面壳补丁得 842,779 字节，VM 实测 842,400，差 **379 字节** —— 正好等于 #82 插入块的字节数。

**修法**：改用 `//#endregion\n//#region ../../packages/util/home-paths/lib/index.js` 做锚点。这段在 rc.5 与 0.2.2 两棵树里都唯一命中，且已打过补丁的文件里不会再命中（标记插在 region 之前，把 `//#endregion\n//#region` 的相邻关系破坏了），**天然幂等**。旧 pattern 保留在后做兜底，两棵树都验过不会双打。

修完 0.2.2 上应为 71 applied / 2 na（原来 70 applied / 2 na / 1 skipped）。

## 密封态「一直扫描」的两个根因

真机（VM）在官方升级到 0.2.2-rc.1 之后，`asar` 重新密封、`app\` 目录消失，面板表现为「一直在扫描补丁数量」。查出来是两处叠加：

### ① 服务端每次都在真扫

`desktop.js` 的 `runningOfficialExecutables()` / `shortcutOfficialExecutables()` 各 spawn 一次 `powershell.exe` 枚举进程/快捷方式（timeout 6000 / 15000），而缓存是**只在结果非空时赋值** —— 注释写的是「客户端可能稍后才启动，缓存空值会让本进程永远找不到它」。

代价是失败路径每次重付全额。密封态恰好就是「找不到安装树」的空结果场景，于是每次 15 秒状态缓存过期，`/status` 都要再 spawn 两次 PowerShell。实测连续打 `/dsh-purge/status`：

```
56,334 ms → 6,794 ms → 489 ms
```

**修法**：引入 `NEGATIVE_TTL_MS = 30000`，空结果缓存 30 秒。既保住「晚点能发现」，又不让失败路径每次重跑。探测**异常**（超时/spawn 失败）仍然不缓存 —— 那不是「确认没找到」，是「没问出来」，下次该重试。`clearDesktopLocateCache()` 一并清掉时间戳与空标记。

### ② 界面一直显示加载

`client.js` 的 `PatchGroups` 在 `!state.ai_base` 时 `return` 一个 96px 高的 `dshp-skel` 骨架屏。本意是「别留白」，但密封态会**长期停在这个分支**，骨架屏在视觉上就是「一直在加载」。

**修法**：改成明确终态文案，按三种情况分别给话 ——

| 状态 | 文案 |
|---|---|
| 密封包（`asar_still_sealed` / `needs_extract`） | 宿主当前是密封包（官方刚升级或还没解开）。点上方「应用」解包后，这里会显示完整补丁表。 |
| 补丁已丢失（`patches_lost`） | 补丁已丢失。点上方「应用」重新打一遍。 |
| 未定位到宿主 | 还没定位到本机 Harness。装好官方客户端后点「应用」即可。 |

新增 i18n 键 `patchlist.sealed` / `patchlist.lost` / `patchlist.unlocated`，中英各一份。

## 验证方式

两棵 **pristine 树**各自从零跑完整管线，逐条用 `core.applyReplacementsToText` 落地，全部产物过 `node --check`：

| 树 | 落地 | 已打 | 无目标 | 死锚点 | 写出文件 | 语法检查 |
|---|---|---|---|---|---|---|
| 0.2.1-rc.5 | 56 | 5 | 11 | 1（#21，历史遗留） | 49 | 39/39 通过 |
| 0.2.2-rc.1 | 60 | 5 | 7 | 1（#21） | 56 | 46/46 通过 |

打完后的面板展示层：rc.5 `54/54` 全绿、0.2.2 `55/55` 全绿，`pending 0 / unmatched 0 / skipped 0`。

**真机验证（VM，0.2.2-rc.1，2026-11-06）**：打完的四个宿主文件与本地模拟逐字节相同 ——

| 文件 | 字节 | SHA256 前 16 位 |
|---|---|---|
| `dsh-agent-loop/lib/index.js` | 68,042 | `4DAE8ADD36D939AF` |
| `dsh-system-prompt/lib/index.js` | 20,895 | `07B25B12407F093E` |
| `dsh-desktop-host/lib/index.js` | 24,812 | `1AE8BAE1D9C851FD` |
| `dsh-fs-observation-policy/lib/index.js` | 3,992 | `9D1EE97C00D4C42D` |

**#21 BASH_TIMEOUT_RESTORE 在两棵树上都是死锚点**，是 1.3.6 就有的历史遗留（正则要求匹配带 `[dsh-purge] bash timeout raised` 标记的行，而 `dsh-base/cordis.patch.yml` 里从来没有这行），不是本次回归。它的 `softSettle: true` 让状态显示为已完成，不影响面板。

## 已知限制

- 0.2.2-rc.1 的 `dsh-tool-executor-ptc` 与 `dsh-deliverable-file-references` 只以 asar 内嵌形式发布，npm 上不存在（`npm view` 返回 404）。这两个 key 只在桌面安装树里生效。
- `#47` / `#49` / `#57` 依赖 `pi-ai-completions` / `pi-ai-responses-shared` / `pi-ai-anthropic-messages` 三个 key，同样只在 0.2.2 的拆包布局里存在；0.2.1 上是 na，属正常。
- `#82` 依赖 `desktop-shell` 键，而 `officialShellMain()` 要靠 `detectSurface()` 认桌面安装位。在纯 CLI 环境（`detectSurface()` 返回 `web`）里这个键解析不到，会显示 na，属预期。
