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
