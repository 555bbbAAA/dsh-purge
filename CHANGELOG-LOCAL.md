# dsh-purge 1.1.72（社区兼容包）

基于上游 1.1.71（2026-10-11）。版本号 2026-10-24 起按 Royan 的决定改为 1.1.72，不再使用字母后缀。
目标宿主：dsh-desktop **0.2.1-rc.2**（兼容 0.2.0-rc.2）。

---

## 0.0 兼容性加固（2026-10-24）

### 背景

宿主仍是 0.2.1-rc.2（exe 10-17），上游 npm latest 同版本，next 为 0.2.1-rc.3。
面板「少 3 个」的根因不是锚点失效，是 dsh-workbuddy-connect 在 10-23 20:26 用 pnpm 把 @earendil-works/pi-ai 升到 1.3.0 装进 profiles 树，而自上次 apply（10-23 12:09）之后没有任何一次重新应用。

### 改动

| 文件 | 位置 | 改动 |
|---|---|---|
| lib/core.js | #47 | 新增结构型兜底：不依赖 initialSystemText / context.systemPrompt 变量名，把 if (isOAuthToken){...} + else if (X){...} 收敛成 if (X){...}（两分支等价） |
| lib/core.js | #49 | 新增三条正则兜底：user-agent 的 claude-cli/${变量}、ccToolLookup.get(...) ?? name、x-app: "cli"；逗号用 $1 保住，避免注释吃掉行尾逗号 |
| lib/core.js | #57 | 新增 responses 通路字面 pattern（instructionRole + !== false，原来这条链一直是裸 developer）+ 可选链/改名兜底正则 |
| bin/dsh-purge.js | --swap-asar | 归档身份比对：app.asar 的 size/mtime 与 unpacked-asar.json 不一致且解包树存在时拒绝（exit 4）并提示改用 --apply；确有需要时 --force |
| cordis.patch.yml | dsh-purge config | autoApplyOnStart: true，启动自愈，profile 树里新装的副本下次启动自动补上 |

### 验证

- 回归：1.3.0 原始备份跑 #47/#49/#57，产物与现网已打好的文件逐字相同
- 合成变体：变量改名、去行尾逗号、可选链三种写法都命中，产物过 node --check
- 落盘后 dsh-purge --status：71/82 已清洗，0 待清洗

### 回滚

lib/core.js.bak-compat-20261024-150122、bin/dsh-purge.js.bak-compat-20261024-150122、cordis.patch.yml.bak-compat-20261024-150122、CHANGELOG-LOCAL.md.bak-compat-20261024-150122。

## 0.0d 移植上游两组修复（2026-10-24，版本仍 1.1.72）

只拿“会坏”的两组，限制类与 license 变更一律不拿。

### 一、停用/卸载后新建会话坏（上游 #108）

- 新增 lib/preset-default.js：clearOwnedSelectedDefault / scheduleClearOwnedSelectedDefault / cancelClearOwnedSelectedDefault / removeStaleAgentPresetDir
- lib/index.js：enabled:false 时复位 selectedDefault 并删 .agent-presets/redteam；正常启动注册 ctx.effect dispose 钩子，用 800ms 延迟避免热重载误清
- lib/uninstall.js：卸载时复位 preset、删 stale 目录；bundle 清理同时覆盖顶层与嵌套 dsh.profile.bundles / dsh.profile.plugins
- lib/redteam/index.js：预设注销时同样触发清理

### 二、0.2.1 上红队预设加载失败

- lib/redteam/tools.js：新增 sealObjectSchemas()，defineTool 包壳递归给 type=object 补 additionalProperties
- lib/redteam/index.js：installPreset 链路接入 stripToolFilter（复用本仓库已有实现），并在 repaired 记录里标 toolFilter

### 验证

- 七个改动文件全部 node --check 通过
- 夹具测试：临时 home 下 cordis.patch.yml 与 cordis.yml 里的 selectedDefault: dsh-purge/redteam 均被改写为 standard，stale 预设目录被删除
- 补丁计数不变：71/82 已清洗，0 待清洗

## 0.0c 换用自家发布仓库 + 页面新版本通知（2026-10-24）

- 版本源与安装源全部指向 555bbbAAA/dsh-purge（原 YuJunZhiXue/dsh-purge 已无引用）：lib/update.js 的 REPO、package.json 的 repository/homepage/bugs/dsh.install、.github/workflows/release.yml 的仓库判断、README 与 release-notes 的链接
- 宿主启动后后台查一次版本并写进 /dsh-purge/status 的 update 字段：普通启动延后 8 秒，检测到刚做过官方升级时 1.5 秒后立刻查，开关 updateCheckOnStart，失败静默
- 客户端新增 UpdateBanner（挂在 shell.overlay 插槽）：页面打开 1.5 秒后读 status，有新版就在右下角弹卡片，关闭按远端版本号记 localStorage
- 实测：本地 1.1.72 对自家 master 1.1.71 → hasUpdate=false，不误报；等 master 提到高于 1.1.72 并推一次，release.yml 会自动建 release，横幅随即出现

## 0.0b 官方「安装新版本」装不上、重启后还是旧页面（2026-10-24 追加）

### 症状

在虚拟机里用 dsh 界面的安装新版本功能：提示有新版、弹窗让重启，点下去以后打开的仍是旧页面，版本也没变。

### 根因（lib/official-update.wscript）

旧判据要求 exe 或 app.asar 的 size / 最后修改时间必须变化才算装成功。
同版本重打包（这次 0.2.1-rc.2 就是 10-17 与 10-18 两个构建）时大小可能一致、时间戳也可能被安装器保留，
于是被判成失败，走失败分支：删掉刚装出来的 app.asar、把旧的 resources\app 挪回来、启动旧 exe。
表现就是更新永远装不上、重启还是旧页面。

### 改动

| 位置 | 改动 |
|---|---|
| 成功判据 | 改为「asar 存在 且（安装器退出码 0 或磁盘确有变化）」，同版本重装不再被当成失败 |
| 失败分支 | 不再删除装完存在的 asar（它可能已经是新构建），只在 asar 缺失时才删除并恢复旧解包目录 |
| 提权 | 退出码 5 / 740 / 1223 时用 RunAs 再跑一次（一次 UAC），不再静默失败 |
| 启动前 | 轮询 asar 大小直到稳定（最多 5 秒），避免应用起在写一半的归档上 |
| 日志 | 逐段记录 installer 退出码、asar 是否存在与大小、verdict、kept-asar / started-old |

### 部署方式

lib/official-update.wscript 是运行时读取的模板（#45 注入的代码按路径读它），换这一个文件就生效，
不需要重新打 main.js 补丁；旧版本插件同样适用。

### 回滚

用上一版包 dsh-purge-1.1.71c.zip 里的 lib/official-update.wscript 覆盖回去即可。


---

## 0. 补充修复：`{{cwd}}` 的取值精度缺口（2026-10-20）

第 1 节让 `{{cwd}}` 不再导致装配失败，但留下一个精度问题：取值链全都没走宿主的 `workingDirectory` 服务，取的是 `session.header.cwd` —— 那是**建会话那一刻**的目录，会话中途切换工作目录后就不准了。

### 症状

会话里 `cd` 到别的目录后，提示词里的「工作目录」仍是旧路径。

### 改动

| 文件 | 位置 | 改动 |
|---|---|---|
| `lib/identity.js` | `resolveCwdValue()` | 新增 `explicitCwd` 参数，最优先返回 |
| `lib/identity.js` | `substituteCwdInterpolation()` | 新增第三个参数 `explicitCwd`，透传下去 |
| `lib/identity.js` | `normalizeRewriteOptions()` | 两个分支都加 `cwd` 透传 |
| `lib/identity.js` | `rewritePromptAssembly()` 末端 | 改为 `substituteCwdInterpolation(outSections, opts.context, opts.cwd)` |
| `lib/index.js` | 新增 `resolveLiveCwd(ctx, context)` | 先走 `ctx.get("workingDirectory").get(session)`，服务缺失才退回 `header.cwd` |
| `lib/index.js` | `rewriteLiveAssembly()` | 新增第 5 参数 `liveCwd`，写进 `rewritePromptAssembly` 的 options |
| `lib/index.js` | 两个调用点（`rewriteFn` / `system-prompt/assemble` 事件） | 传 `resolveLiveCwd(ctx, context)` |

### 为什么不把 workingDirectory 加进 inject

旧宿主（0.2.0）没有这个服务，加进 `inject` 会让整个插件加载失败。用 `ctx.get()` 判空降级，两个版本都能跑。

### 验证

```
语法      lib/identity.js、lib/index.js 均 node --check exit 0
单测      resolveCwdValue 五个用例全过
集成      传 cwd / 不传 / 传空串 三组行为符合预期
真机      重启后切目录，日志 cwd 字段立即从 I:\工作区 变为 I:\zhuomian
```

真机验证是本修复唯一的可信判据 —— `header.cwd` 与实时值在未切目录时恰好相同，光看日志无法区分。

---

## 1. 修复：`{{cwd}}` 在 0.2.1 上导致整轮运行失败（P0）

### 症状

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

0.2.1 的 `@deepseek-ai/dsh-system-prompt` 把提示词插值变量收窄为 `provider`、`model` 两个。
任何 prompt section 里出现 `{{cwd}}` 都会在装配阶段抛错，整轮对话无法开始。

### 改动

| 文件 | 位置 | 改动 |
|---|---|---|
| `lib/identity.js` | `CWD_ONLY_SUFFIX` | `"Your working directory is {{cwd}}."` → `""` |
| `lib/identity.js` | `stripHarnessPersona()` 两处 replace 目标 | `"Working directory: {{cwd}}. "` → `""` |
| `lib/core.js` | `ALLOW_EXEC_PERSONA_BLOCK` 前缀 | `"Working directory: {{cwd}}.\n"` → `""` |
| `lib/core.js` | `ALLOW_EXEC_PERSONA_LINE` 前缀 | `"Working directory: {{cwd}}. "` → `""` |
| `cordis.patch.yml` | `system-prompt.config.personaSuffix` | 置空 |

### 保留未改

`identity.js` 的 `isCwdOnlyText()` 与 `core.js` L6515 仍保留 `{{cwd}}` 字面量 —— 它们只做**字符串比较**，不参与输出，不会触发插值校验。

### 工作目录上下文去哪了

- **0.2.1**：由 `@deepseek-ai/dsh-working-directory` 与 `system-prompt.includeRuntimeContext` 提供。
- **0.2.0**：官方 bundle 的 `system-prompt.config.personaSuffix` 默认值本身带 `{{cwd}}`，由宿主渲染。插件置空只是把它让回官方。

---

## 2. 修复：`rules` 命令重复注册的日志噪音（P1）

### 症状

```
[commands.fail] name=rules  err=command "rules" is already registered
```

实测累计 28 次失败 / 84 次成功（约 1:3）。

### 事实澄清

| 来源 | `lib/index.js` | 命令注册 |
|---|---|---|
| 上游 **master 分支** | 107,472 B | 裸 `commands.register(...)`，无容错 |
| 上游 **v1.1.71 release 包** | 108,592 B | 带 `safeRegister` 容错包装 |

即：**容错包装在 release 包里，master 分支反而没有**。网络上常说的「master 比 release 新」在这个仓库不成立。

### 改动

保留 release 包的 `safeRegister`，仅把「已注册」这一类错误从 `fail` 降级为 `skip`：

```js
const safeRegister = (def) => {
  try { commands.register(def); purgeLog("commands.ok", { name: def.name }); }
  catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/already registered/i.test(msg)) purgeLog("commands.skip", { name: def.name });
    else purgeLog("commands.fail", { name: def.name, err: msg });
  }
};
```

重复注册本身不会消失（`cordis.patch.yml` 里挂了 `dsh-purge`、`dsh-purge-redteam`、`dsh-purge-redteam-store`、`dsh-purge-redteam-ui` 四个实例，主实例的 `apply()` 会被多次调用），但它已被 `safeRegister` 捕获，功能不受影响。这里只是消除日志噪音。

> 若要根治，应在 `apply()` 入口加实例级幂等旗标（如 `ctx.get("purge.booted")`），属结构性改动，建议上游自行判断。

### 根因（已定位）：与 `dsh-permission-rules` 的命令名冲突

不是本插件自身重复注册，而是**另一个插件先占用了 `rules` 这个命令名**。

证据在 `node_modules/dsh-permission-rules/lib/index.js` 第 4688 行：

```js
ctx.commands.register({
  name: "rules",
  description: "list, reload, audit, dry-test, or inspect the network policy of the active permission rules for this workspace",
  input: { hint: "[list | reload | network | decisions [n] | test ...] <tool> <json-args>" },
  handler: (invocation) => runtime.command(invocation)
});
```

`dsh-commands` 的 `CommandLayer` 对全局层用 `NamedEntries` 做唯一性约束，重名时的报错原文正是我们看到的：

```
command "rules" is already registered (for a per-agent variant, mount a command-injected plugin under that agent's `agent.ctx`)
```

括号里那句 `for a per-agent variant...` 只在 `scope === undefined`（全局层）时出现，说明两边都在全局层注册。

bundle 加载顺序里 `dsh-permission-rules` 排在 `dsh-purge` 之前，所以它先注册成功，purge 的 `rules` 必然失败。

### 排除了什么

- 本插件 `index.js` 只有一处 `safeRegister`，四个命令各注册一次
- `lib/redteam/index.js` 的 `apply()` 声明 `inject = []`，不碰 commands
- `@deepseek-ai` 306 个宿主包全量提取 `.register({ ... name: "x" })`，得到的命令名是 `file / main / compact / feedback / goal / permission / plan / export`，**没有 `rules`**

### 影响面

`/rules` 目前指向 permission-rules 的网络策略功能（list / reload / network / decisions / test），purge 的规则集切换（list / use / create / delete / reset）**在这个组合下不可用**。功能上无崩溃，只是命令被遮蔽。

### 建议

1. 短期：本版已把冲突降级为 `commands.skip`，不再刷 fail 日志。
2. 中期：建议上游把命令改名为 `purge-rules` 或 `purgectl`，避开与权限规则插件的命名空间争用。
3. 或者由 Host 层提供命令命名空间（如 `purge:rules`），彻底消除跨插件重名。

---

## 3. 已知无害项：4 条补丁的目标包在 0.2.1 被移除（P2）

| 补丁 | 目标包 | 0.2.1 | 现有标记 |
|---|---|---|---|
| `#64 HOOKS_STOP_STEER_NEUTRAL` | `dsh-hooks-claude-code` / `dsh-hooks-codex` | 已移除 | `optional: true` |
| `#65 HOOKS_PRESTEP_REJECT_NEUTRAL` | 同上 | 已移除 | `optional: true` |
| `#71 LIANGSHEN_IDENTITY_LINE` | `dsh-preset-liangshen` | 已移除 | `strictFiles: true` |
| `#76 PRESET_UNRESTRICTED_IDENTITY_STRIP` | `preset-unrestricted` | 非内置预设 | `optional: true` |

### 已核实：0.2.1 里没有替代实现

在 `@deepseek-ai` 306 个包里逐个查过：

- `dsh-hooks-claude-code` / `dsh-hooks-codex` —— **不存在**
- `dsh-preset-liangshen` / `dsh-preset-liangshen-pkg` / `dsh-liangshen-tool-bootstrap` —— **不存在**
- `preset-unrestricted` —— `dsh-web-app/presets/` 下只有 `cordis` / `minimal` / `ptc` / `standard` 四个，**没有 unrestricted**
- 全包搜 `hook|liangshen` —— 只命中官方 preset 体系（`dsh-agent-preset` 等），无 hooks 插件

结论：这四条对应的能力在 0.2.1 被整体移除，**不是改名或搬家**。建议上游按版本锚定：`dshTarget >= 0.2.1` 时直接从补丁表剔除，而不是每次 apply 打印一次「⚠ 文件缺失」。

四条在 `patchStatus` 里均落成 `skipped`（`DISPLAY_SKIP` 已含 `missing_file`），不参与分母、不影响其余补丁。

---

## 3.5 0.2.0 兼容性实测（决定 0.2.0 用户装这个包会怎样）

| 事实 | 0.2.0 | 0.2.1 |
|---|---|---|
| `dsh-web-app/cordis.patch.yml` 里的 `personaSuffix` | `Your working directory is {{cwd}}.` | **整行不存在** |
| `{{cwd}}` 插值变量由谁注册 | `dsh-agent-loop/lib/index.js` L1582 | **不再注册** |
| 插件置空 `personaSuffix` 的后果 | 官方默认那行被覆盖，**提示词里少一行工作目录** | 无损失 |

所以：**0.2.0 用户装本包，功能不受影响，但会丢失提示词中的工作目录行**。若上游要同时支持两个版本，正确做法不是简单置空，而是：

1. 删掉 `cordis.patch.yml` 里的 `personaSuffix` 覆盖，让官方默认生效（0.2.0 有、0.2.1 没有，天然兼容）；
2. `identity.js` 的 `overlayOfficialIdentity()` 在 `sawSuffix` 为真时不要再把它替换成空串。

本机采用第 3 节的置空方案，是因为只保 0.2.1 且要最小改动。

---


## 4. 实测结果（0.2.1-rc.2 / Windows / dsh-desktop）

| 项 | 值 |
|---|---|
| 补丁 | 60 / 66 applied，**0 pending**，6 skipped |
| 提示词注入 | `rawBytes=42096 outBytes=42096`，连续多轮稳定 |
| 模块导出 | `name=dsh-purge`、`inject=["systemPrompt","tools"]`、`apply` 为函数 |
| 插件根 | `resources/app/dsh/node_modules/@deepseek-ai`（解包态） |
| 进程内存 | 主进程 339 MB |

---

## 4.5 回应维护者反馈：临时文件替换的权限保留与备份中止

维护者指出两点：①临时文件重命名替换原文件时应保留原 rwx 权限，否则 CLI 可能从可执行变成权限被拒绝；②备份失败应中止改写。两点都已核实成立并修复。

### 4.5.1 `atomicCopyFile` / `atomicWriteFile` 保留权限位

原实现：

```js
const tmp = `${dst}.${pid}.${ts}.copytmp`;
await fsp.copyFile(src, tmp);   // 新建文件 = 默认权限
await fsp.rename(tmp, dst);     // 覆盖后原权限丢失
```

`copyFile` 与 `writeFile` 建出的临时文件走默认 umask，`rename` 替换之后目标文件的权限位就变了。可执行脚本被这样替换一次，x 位就没了。

修复：替换前用 `stat` 记录权限，写入后 `chmod` 回临时文件再 rename。

```js
async function modeOf(fp) {
  try { return (await fsp.stat(fp)).mode & 0o777; } catch { return void 0; }
}
// copyFile 场景：优先沿用目标既有权限，首建时沿用源文件权限
const mode = (await modeOf(dst)) ?? (await modeOf(src));
```

平台差异：Windows 上 `fs.chmod` 只影响只读位（实测 `chmod 755/700/600` 后 `stat` 一律返回 `666`，仅 `444` 生效），所以本机无法实测 POSIX 位的保留效果；改动对 Windows 无害，对 macOS/Linux 有效 —— 维护者分叉里处理的正是 macOS CLI 执行权限，这条应能直接受益。

### 4.5.2 备份失败中止改写

原实现把 `backupAll()` 的返回值丢弃后继续打补丁：

```js
await backupAll(aiBase);
const report = await applyPatches(aiBase, selected, options);
```

`backupAll` 本身会收集 `errors`（返回 `{ made, errors, skippedUser, dropped }`），但没人看。备份失败 = 没有回滚点，后续改写一旦出问题就无法还原。

修复：

```js
const backup = await backupAll(aiBase);
if (Array.isArray(backup?.errors) && backup.errors.length > 0) {
  const first = backup.errors[0];
  const fp = Array.isArray(first) ? first[0] : "";
  const msg = Array.isArray(first) ? first[1] : String(first);
  throw new Error(`dsh-purge: 备份失败，已中止改写 ${fp}（${msg}）`);
}
```

### 4.5.3 与本机一次真实故障的关系

本机升级 dsh 0.2.1 时，`apply` 曾崩在：

```
EPERM: rename '...\dsh.cmd.dsh-purge.bak.18388.1792309952978.copytmp'
         -> '...\dsh.cmd.dsh-purge.bak'
```

那一刻正是 `atomicCopyFile` 在备份 shim。若 6.1/6.2 已在，行为会是：备份失败 → 立即中止并给出明确错误，而不是继续往下写到一半崩掉、留下半套改动的宿主。

---

## 5. 给上游的提交建议

1. **第 1 节**是通用修复，不依赖本机环境，可直接提 PR。核心不是简单删掉 `{{cwd}}`，而是意识到该变量在 0.2.1 已不被注册，应改为运行时拼实际路径或直接让位给宿主的 working-directory 能力。
2. **第 2 节**建议上游把 release 包的 `safeRegister` 合并回 master（master 目前是裸调用），并把「已注册」错误单独归类。
3. `package.json` 的 `dshTarget` 扩展为 `0.2.1-rc.2`。
4. **第 3 节**建议加包存在性预检，把「⚠ 文件缺失」降级为 debug 日志。
5. **第 4.5 节**的两处修复（权限保留、备份中止）为维护者反馈直接落地，建议优先合入。

---

## 4.6 修复：换包助手杀掉自己，app.asar 永远挪不开（#133）

### 症状

点「应用」后，桌面端弹「应用无法启动或已意外停止」，而 `resources/app.asar` 原地不动，写在 `resources/app` 里的补丁全部被遮蔽。日志只写到：

```
[dsh-purge] asar swap: no runtime handoff, relying on PowerShell to kill Electron first
```

之后再无任何行 —— `Move-Item` 与 `Start-Process` 从未执行。

### 两个根因

**① Windows 的 `detached: true` 不脱离 job object**

`spawn("powershell.exe", [...], { detached: true, stdio: "ignore" })` 在 Windows 上只保证「父进程退出后子进程继续运行」，但子进程仍在父进程所属的 job object 里。宿主被杀时 job 一起终止，PowerShell 助手跟着死。

**② `Stop-HarnessInstall` 按安装根目录匹配，把助手自己也算进去了**

```powershell
return (\ -eq \) -or \.StartsWith(\.ToLower() + '\\')
```

助手脚本落在 `%TEMP%`，但执行它的 `powershell.exe` 如果被判定在安装根下（或助手被 WMI 创建后父进程链仍可追溯），第一轮 `Stop-HarnessInstall` 就会把它带走。

### 改动

**① 改用 WMI 创建助手**

不再直接 spawn，而是 spawn 一个短命 launcher，由它调用 `Invoke-CimMethod -ClassName Win32_Process -MethodName Create`。WMI 创建出来的进程父进程是 `WmiPrvSE.exe`，不在宿主 job object 内。

**② `Stop-HarnessInstall` 排除自身**

```powershell
\ = @(\40584)
try { \ += (Get-CimInstance Win32_Process -Filter "ProcessId = \40584" -ErrorAction SilentlyContinue).ParentProcessId } catch {}
...
if (\ -contains \.ProcessId) { return \False }
```

### 验证

| 测试 | 结果 |
|---|---|
| WMI 创建的助手，父进程退出后继续执行 | ✅ 正常写入标记 |
| `Stop-HarnessInstall` 杀掉安装目录内进程 | ✅ 假宿主被终止 |
| 同上，助手自身存活 | ✅ 脚本继续跑到 `after-kill` |

### 仍未解决

**更正**：`wscript` 不是死代码。实测（2026-10-19）`wscript.exe //nologo //B script.js` 能正常执行，前提有两条，代码里都已满足：①生成的文件用 `.js` 扩展名（`wscript` 不认 `.wscript`）；②脚本本体必须是纯 ASCII —— 走 `wshLiteral` 把非 ASCII 字符转成 `\\uXXXX` 转义，且文件不带 BOM（带 BOM 会报 `JavaScript compilation error: Expected ';'`）。`restartOfficialHarness` 就是走这条路，前面还有 `probeWshJsEngine()` 先用 `cscript` 试跑一次再决定。之前按 #66 的描述写成「wscript 分支不生效」是错的。
- 真机验证：本机是 0.2.1-rc.2 手动移走 asar 的状态，官方换包流程没有完整复现

---

## 4.7 换包链路真机验证与三处根因（#133 收口）

上一版只做到「脚本逻辑正确、进程能存活」，没有跑通完整链路。这一版把整条链在隔离环境里跑通了，并在过程中挖出三个串在一起的根因。

### 根因一：detached: true 不脱离 job object（推断，未直接证实）

Windows 上 spawn(..., { detached: true }) 只保证「父进程退出后子进程继续跑」，子进程仍在父进程的 job object 里。宿主被杀时 job 一起终止，助手跟着死，Move-Item 永远执行不到。

**改法**：交给任务计划程序启动。schtasks /create + /run 起的进程由 Task Scheduler 服务创建，不在宿主 job 内。

### 根因二：.cmd 垫片的编码问题

第一版想用 /tr 指向一个 .cmd 垫片来规避命令行长度限制，结果 cmd.exe 按系统 ANSI（GBK）解析 .cmd，用 UTF-8 写进去的中文路径直接变乱码：

```
C:\Users\张\AppData\...   →   C:\Users\寮燶AppData\...
```

任务计划实际执行的是一条指向不存在路径的命令，静默失败。

**改法**：彻底去掉垫片，把 $WaitPid / $AsarPath / $ExePath 直接烧进脚本正文，/tr 里只剩一个 -File。

### 根因三：.ps1 缺 BOM，PowerShell 5.1 按 GBK 读

参数烧进正文之后仍然失败，日志显示 efore-move moved=True —— 说明 $AsarPath 判空成立，路径根本没被正确解析。原因是 PowerShell 5.1 读**无 BOM 的 UTF-8** 脚本时按系统 ANSI 解析，中文路径再次变乱码。

**改法**：写脚本时带 UTF-8 BOM（"\uFEFF" + scriptText）。

### 验证（隔离环境，假安装目录 + 假宿主）

| 步骤 | 结果 |
|---|---|
| 假宿主运行中 → 触发换包 | ✅ 假宿主被终止 |
| pp.asar 移动 | ✅ 移到 pp.asar.bak |
| 重新启动应用 | ✅ 新进程出现（PID 变更） |
| 分步日志 | ✅ start / kill-round-1 / kill-round-2 / before-move / moved-ok 五步齐全 |

日志落在 %TEMP%\dsh-purge-asar-swap.log，出问题时能直接看出死在哪一步。

### 新增：离线换包命令 --swap-asar

不需要杀进程、不会弹崩溃对话框、不依赖进程能否逃出 job object —— 只要应用是关着的就一定成功。

```bash
# 1. 完全退出应用（含托盘）
# 2. 换包
dsh-purge --swap-asar
# 3. 重新打开应用
```

行为要点：
- 检测到同名进程在跑就拒绝并提示，不会挪走正在使用的 asar（Windows 上打开中的文件仍可 rename，不能靠 EPERM 判断）
- 已有 .bak 时用带时间戳的新名字，不覆盖上一份备份
- 已是解包态时直接报「无需换包」
- --apply 结束时若发现 asar 尚未换包，会明确提示走这条路径

### 仍未解决


- 真实 Electron 宿主上的完整换包未验证：本机 asar 早已手动移走，隔离环境用的是假宿主的 ping/powershell 进程

---

## 4.8 兜底：装配前统一替换残留的 {{cwd}}

### 为什么还要再修一次

4.1 节把插件自己五处输出里的 {{cwd}} 删了，但那只覆盖「插件写死的文本」。

实测仍有用户在**插件根尚未定位**（asar 还密封、补丁一条没打）的状态下每轮报：

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
registered variables: provider, model
```

来源不是插件的常量，而是**官方 bundle 自带的 personaSuffix**——overlayOfficialIdentity() 要等插件正常接管才会把它改写成空串，而接管之前那段原文原样进装配，0.2.1 又不注册 cwd，于是整轮起不来。

### 改法

在 identity.js 装配流水线的最后（overlayOfficialIdentity 之后）加一道替换：

```js
outSections = substituteCwdInterpolation(outSections, opts.context);
```

substituteCwdInterpolation() 把**所有 section** 里的 {{cwd}} 换成真实工作目录：

- 取值顺序：context.cwd → context.workspace.cwd → context.workspace.root → context.deployment.cwd → context.session.cwd → context.meta.cwd → process.cwd()
- 用 split/join 而非正则，避免路径里的特殊字符被当成替换模式
- 不含 {{cwd}} 时原样返回同一个数组引用，零开销

### 效果

| 场景 | 修之前 | 修之后 |
|---|---|---|
| 插件根未定位（asar 密封） | 每轮抛错，应用不可用 | 正常对话，只是补丁还没打 |
| 插件根已定位、补丁已打 | 正常 | 正常（替换后内容相同） |
| 用户自己的 section 里写了 {{cwd}} | 抛错 | 正常显示真实路径 |

这一条让「装好插件但还没点应用」这个中间状态不再是死局——用户可以先进应用，再点应用。

### 验证

单元测试：单处、多处、无变量、无 context 四种输入全部通过；--status 回归 71/82 不变；七个文件语法检查 exit 0。

---

## 4.9 新增 --diag：逐条逐文件诊断

### 为什么加

现场反馈「点应用只打进 3 个补丁」「7/66 applied，54 pending」，但 --status 只给汇总，压缩掉了「卡在哪个文件、哪条 needle」。没有这两点，只能靠猜。

### 用法

```bash
dsh-purge --diag          # 只列未 applied 的
dsh-purge --diag=all      # 全列
```

每个文件输出一行：

```
#46  OFFICIAL_DESKTOP_UPDATE_ASCII   pending
     dsh-system-prompt\lib\index.js   outcome=pending  bytes=20030  marker=0/1  needle_hit=2
       ↳ 命中: const transformed = await this.ctx.waterfall(scopeTarget(this, sc
```

字段含义：

| 字段 | 含义 |
|---|---|
| outcome | applied / pending / skipped |
| marker=N/M | 补丁的标记命中几个 / 共几个 |
| 
eedle_hit=N | 原文 pattern 还命中几处 |
| ↳ 命中 | 具体命中的 pattern 前 60 字符 |

末尾附判读提示：

- pending + needle_hit>0 → 原文还在，替换没干净
- pending + needle_hit=0 → 原文找不到也没标记，通常是路径指向了别的树
- skipped → 这份文件本来就没该原文，正常
- missing_file → 包目录不存在，版本布局不同

### 实现

core.js 新增 export async function diagnosePatches(aiBase)，复用内部 ilePatchSettled / ilePatchOutcome / matchesPattern / patchReplacements，保证诊断结论和真实判定同源，不是另写一套。

### 本机验证

```json
{"applied":71,"missing_file":7,"skipped":4}
```
与本机 --status 的 71/82 完全一致。

---

## 4.10 按真机报告修的四处

来源： .2.1-rc.2 + 1.1.71c 的完整安装报告（37 分钟实装，含换包成功）。

### A5 --apply 在 asar 密封时返回非 0

**问题**：补丁写进了 esources\app，但 Electron 读的是 pp.asar，补丁全被遮蔽；而 --apply 只打印一行提示、**退出码仍是 0**。脚本和自动化会当成已完成，现场就是靠这个骗过一次。

**改法**：检测到 asar 仍在时，打印明确说明并 process.exit(3)。UI 走的是 core 函数，不受影响。

### A6 修正误导性日志

**问题**：desktop.js 里那句 wscript 不能执行 .js，改用 PowerShell 挪开 app.asar 把结论写成了原因。它实际位于「已经决定走 PowerShell」的分支里，真实原因是探针 probeWshJsEngine() 没通过或脚本非 ASCII。这句话误导过两次判断（一次以为 wscript 是死代码）。

**改法**：改成 sar swap: 走 PowerShell/schtasks 路径（wscript 探针未通过或脚本非 ASCII）。

### A3 两套计数口径写明

**问题**：CLI 报 71/82，插件面板报 61/66，都是 0 pending，但分母不同，容易被当成矛盾。

**改法**：--status 在补丁统计下补两行口径说明——完整表多少条、当前布局适用多少条、面板是折叠计数。不断言面板的具体折叠算法，只说「两个口径的待清洗应当一致」。

### A8 dshpurge-prev 只留最近一份

**问题**：每换一次包多留一份 pp.dshpurge-prev，实测 **413 MB/份**；加上 pp.asar.bak 的 174 MB，两次换包就接近 1 GB。

**改法**：commitExtractedDir() 成功后调 prunePreservedDirs(destDir, 1)——prev 只留最近一份做回滚点，dshpurge-failed-* 残骸全清。清理失败不影响换包结果。

单元测试：造 3 份 prev + 2 份 failed，跑完只剩最新 1 份 prev。

### A2 --status 检测 bundle 注册状态

**问题**：dsh.profile.bundles 里声明了 dsh-purge，但 dependencies 是空的，一次 pnpm install 就把注入链接 prune 掉；宿主 app-boot 对解析失败的 bundle **静默跳过**，界面完全正常，插件就是不工作。

**改法**：新增 undleRegistrationIssues(dshHome)，--status 里逐个 profile 检查「声明了 bundle 但 dependencies 为空或 node_modules 缺失」，命中就标红并给出修复命令：

```
  ⚠ profile「desktop」声明了 dsh-purge 但解析不到
    dependencies: (空)   node_modules: 缺失
    宿主会静默跳过这个 bundle，插件等于没装。修复：
    dsh plugin --profile desktop add file:C:/Users/x/.dsh/plugins/dsh-purge
```

单元测试：造 broken / healthy / other 三个 profile，只检出 broken 那个。

### 验证

四个文件语法 exit 0；--status 回归 71/82 不变，无 bundle 告警（本机依赖正常）；prunePreservedDirs 与 undleRegistrationIssues 均有单测。

---

## 4.11 收尾三项：重启延迟、shim 回退、日志编码

### A7 重启延迟参数

**问题**：助手最后一条回复还没落地，应用就被杀掉重启，只能自己在外面写延迟脚本。

**改法**：环境变量 DSH_PURGE_RESTART_DELAY_MS（0–60000，默认 0），烧进换包脚本，在**杀进程之前** Start-Sleep：

```powershell
# 让回复发完再重启
 = "8000"
# 然后点「应用」
```

脚本里会留一行 delay 8000ms before kill 到 %TEMP%\dsh-purge-asar-swap.log，便于确认生效。

实测：设 8000 时脚本内确实出现 \ = 8000 且含 Start-Sleep -Milliseconds \。

### C1 shim 目录回退到官方自带 CLI

**问题**：~/.dsh/bin 不存在，dsh / dsh.ps1 都不在 PATH，indShimDir() 返回 null，shim 补丁被静默跳过。

**改法**：indShimDir() 在现有候选全部落空后，再探一次官方桌面自带 CLI：

```
<安装目录>/resources/runtime/cli/bin
```

本机实测：shim 目录 I:\deepseek\resources\runtime\cli\bin——之前是空。

### C3 日志加 UTF-8 BOM

**问题**：日志是 UTF-8 无 BOM，PowerShell 5.1 按 ANSI 读，中文全是乱码，排查时读不了。

**改法**：logInternal() 在文件首次创建（或大小为 0）时补 \uFEFF，之后追加不再补。

### 验证

八个文件语法 exit 0；--status 回归 71/82 不变，且 shim 目录从「未定位」变成能解析到官方 CLI 路径。

---

## 4.12 真机报告第二轮：#1 换包不绑定、#3 全量重写、#4 无日志、#9 0.2.0 回归

### #1 换包与打补丁强绑定（最严重）

**现场证据**：13:09:52 换包成功 → 13:10:12 从 esources\app 启动 → **13:23 实测该树与 pp.asar 原版逐字节相同（未打补丁）** → 补丁 13:27:51 才落盘。中间 17 分钟应用跑的是原版，而 --status 报 61/66 applied。

**根因**：scheduleApplyRestart() 里只要 desktopAsarStillSealed() 为真就直接调 estartSealedDesktopIfNeeded() 换包，**从不检查补丁有没有写进那棵树**。

**改法**：estartSealedDesktopIfNeeded() 在换包前加两道闸：

1. esources/app 里必须有 @deepseek-ai —— 否则 locked: no_unpacked_tree
2. 该树必须 hostCleanMarkersPresent() —— 否则 locked: patches_not_written

不满足就返回 sarSwap: false + 明确错误，**拒绝换包**。换包之后 Electron 只读那棵树，没补丁就等于静默跑原版，比换包失败更糟。

### #9 {{cwd}} 在 0.2.0 上丢上下文（我引入的回归）

**问题**：之前把 CWD_ONLY_SUFFIX 置空来解决 0.2.1 不注册 cwd 的问题，但在 **0.2.0**（注册 cwd）上等于白丢「工作目录」这条上下文。

**改法**：CWD_ONLY_SUFFIX 恢复成 "Your working directory is {{cwd}}."，由流水线末端的 substituteCwdInterpolation() 换成真实路径。两个版本都拿到实际路径：

```
CWD_ONLY_SUFFIX = "Your working directory is {{cwd}}."
替换后            = "Your working directory is C:/work/proj."
```

### #3 跳过已命中的文件

**问题**：53 个文件全走「读-改-备份-原子写」，mtime 全刷新；4 GB 机器上叠加 Defender 扫描直接把系统拖死。

**改法**：pplyPatches 循环里，ilePatchSettled() 为真就直接 lready += 1 跳过，不再读改写。

实测：全量已应用的树上再跑 --apply，apply 日志里**一条 write 都没有**。

### #4 apply 落盘日志

**问题**：--apply 的输出只在终端，机器卡死或重启后完全查不到它写没写、写到哪。

**改法**：%TEMP%\dsh-purge-apply.log，首次创建补 UTF-8 BOM，逐条记录：

```
2026-10-19T05:33:02.515Z apply:start patches=82
2026-10-19T05:33:02.7xxZ patch #46 write C:\...\dsh-system-prompt\lib\index.js bytes=20622
```

实测：文件首三字节 EF BB BF（BOM 正常），全量已应用时只有 start 一行、无 write 行。

### 仍未做

- #2 journal / --resume：写前落 journal、单文件原子替换、按 --diag 只补 pending
- #5 回滚点硬链接快照（413 MB → 5 MB 级）
- #6 link: 替代 injected 副本、#7 生成 dsh.ps1 / dsh、#8 obsolete 状态剔除分母

---

## 4.13 新增 --fix-shim：换包后 CLI 失效的补救

### 问题

官方安装包自带的 esources\runtime\cli\bin\dsh.cmd 把 CLI 路径写死了：

```cmd
"%~dp0..\..\..\..\DeepSeek Harness.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
```

换包把 pp.asar 改名为 pp.asar.bak 之后这条路径就不存在了，dsh plugin ... 直接不能用。

**责任一半一半**：安装包写死路径是一半，我们换包让它失效是另一半。

### 为什么不直接改官方文件

patchShim() 里本来就有闸：isDesktopCommandRuntimeDir(shimDir) 为真时返回 skipped_sealed_desktop，设计上不碰安装包自带文件——升级安装包会覆盖，改了白改。

### 改法

新增 --fix-shim，在 <DSH_HOME>\bin 生成一套自适应的启动器（不动官方文件）：

| 文件 | 内容 |
|---|---|
| dsh.ps1 | 承载全部路径判断：pp 存在就用 pp，否则回退 pp.asar。带 UTF-8 BOM |
| dsh.cmd | **纯 ASCII 转发**，只调 dsh.ps1，不含任何路径 |

.cmd 之所以不写路径：cmd.exe 按 GBK 解析文件，UTF-8 写进去的中文路径会变乱码（本项目已经在这上面栽过两次）。

### 实测

```
dsh.ps1  --version        → 0.2.1-rc.2    exit 0
dsh.cmd  --version        → 0.2.1-rc.2    exit 0
dsh.cmd  plugin --help    → 正常输出 pnpm 转发帮助，exit 0
```

生成的 dsh.ps1 内容：

```powershell
 = 'I:\deepseek\DeepSeek Harness.exe'
 = 'I:\deepseek\resources\app\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
if (-not (Test-Path -LiteralPath )) {  = 'I:\deepseek\resources\app.asar\dsh\node_modules\...' }
1 = '1'
&  --expose-internals  @args
exit 
```

### 用法

```powershell
dsh-purge --fix-shim
# 然后把打印出来的那一行执行一次，把 <DSH_HOME>\bin 加进用户 PATH
```

### 踩到的一个小坑

帮助文本里写 <DSH_HOME>\bin，出现在 JS 模板字符串中，\b 被当成退格转义，打印出来变成 <DSH_HOME>in。改成 <DSH_HOME>/bin 绕开。

---

## 4.14 修 --fix-shim 的 PATH 提示会污染用户 PATH

### 问题

原来打印的是：

```powershell
[Environment]::SetEnvironmentVariable("Path", \F:\xuniji2\bin\;%S;stemRoot%\system32;C:\WINDOWS;C:\WINDOWS\System32\Wbem;C:\WINDOWS\System32\WindowsPowerShell\v1.0\;C:\WINDOWS\System32\OpenSSH\;C:\Program Files\dotnet\;C:\Program Files\Microsoft SQL Server\150\Tools\Binn\;C:\Program Files\Bandizip\;C:\WINDOWS\system32;C:\Program Files\python;C:\Program Files\python\Scripts;E:\BtSoft\panel\script;C:\Program Files\Common Files\Autodesk Shared\;C:\Program Files\PuTTY\;C:\Program Files\python;C:\Program Files\python\Scripts;F:\bendiwangzhan2\BtSoft\panel\script;C:\Program Files\nodejs\;C:\Program Files\NVIDIA Corporation\NVIDIA App\NvDLISR;C:\Program Files (x86)\NVIDIA Corporation\PhysX\Common;C:\Program Files\Git\cmd;C:\Program Files\Docker\Docker\resources\bin;I:\1;I:\1\Scripts;I:\abc\12;I:\abc\12\Scripts;C:\Program Files\WSL\;C:\Program Files\GitHub CLI\;I:\deepseek\resources\runtime\cli\bin;C:\Users\张\AppData\Local\Programs\Python\Python313\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python313\;C:\Users\张\.local\bin;C:\Users\张\AppData\Local\Programs\Python\Python310\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python310\;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\.dotnet\tools;E:\Microsoft VS Code\bin;C:\Users\张\AppData\Local\Programs\Fiddler;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\AppData\Local\Programs\Ollama;C:\Users\张\.lmstudio\bin;C:\Users\张\AppData\Roaming\npm;C:\Users\张\.lmstudio\bin + ";<bin>", "User")
```

\F:\xuniji2\bin\;%S;stemRoot%\system32;C:\WINDOWS;C:\WINDOWS\System32\Wbem;C:\WINDOWS\System32\WindowsPowerShell\v1.0\;C:\WINDOWS\System32\OpenSSH\;C:\Program Files\dotnet\;C:\Program Files\Microsoft SQL Server\150\Tools\Binn\;C:\Program Files\Bandizip\;C:\WINDOWS\system32;C:\Program Files\python;C:\Program Files\python\Scripts;E:\BtSoft\panel\script;C:\Program Files\Common Files\Autodesk Shared\;C:\Program Files\PuTTY\;C:\Program Files\python;C:\Program Files\python\Scripts;F:\bendiwangzhan2\BtSoft\panel\script;C:\Program Files\nodejs\;C:\Program Files\NVIDIA Corporation\NVIDIA App\NvDLISR;C:\Program Files (x86)\NVIDIA Corporation\PhysX\Common;C:\Program Files\Git\cmd;C:\Program Files\Docker\Docker\resources\bin;I:\1;I:\1\Scripts;I:\abc\12;I:\abc\12\Scripts;C:\Program Files\WSL\;C:\Program Files\GitHub CLI\;I:\deepseek\resources\runtime\cli\bin;C:\Users\张\AppData\Local\Programs\Python\Python313\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python313\;C:\Users\张\.local\bin;C:\Users\张\AppData\Local\Programs\Python\Python310\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python310\;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\.dotnet\tools;E:\Microsoft VS Code\bin;C:\Users\张\AppData\Local\Programs\Fiddler;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\AppData\Local\Programs\Ollama;C:\Users\张\.lmstudio\bin;C:\Users\张\AppData\Roaming\npm;C:\Users\张\.lmstudio\bin 是**机器级 + 用户级合并值**。直接执行等于把整份系统路径复制进用户 PATH，用户 PATH 被撑大、还会跟机器级更新打架。现场测试时对方不得不先备份 User PATH 才敢执行。

### 改法

只读写 User 作用域，并做成幂等：

```powershell
\=[Environment]::GetEnvironmentVariable('Path','User')
if (";\;" -notlike "*;<bin>;*") {
  [Environment]::SetEnvironmentVariable('Path', ((\ -replace ';+\$','') + ';<bin>'), 'User')
}
```

要点：①用 GetEnvironmentVariable('Path','User') 而非 \F:\xuniji2\bin\;%S;stemRoot%\system32;C:\WINDOWS;C:\WINDOWS\System32\Wbem;C:\WINDOWS\System32\WindowsPowerShell\v1.0\;C:\WINDOWS\System32\OpenSSH\;C:\Program Files\dotnet\;C:\Program Files\Microsoft SQL Server\150\Tools\Binn\;C:\Program Files\Bandizip\;C:\WINDOWS\system32;C:\Program Files\python;C:\Program Files\python\Scripts;E:\BtSoft\panel\script;C:\Program Files\Common Files\Autodesk Shared\;C:\Program Files\PuTTY\;C:\Program Files\python;C:\Program Files\python\Scripts;F:\bendiwangzhan2\BtSoft\panel\script;C:\Program Files\nodejs\;C:\Program Files\NVIDIA Corporation\NVIDIA App\NvDLISR;C:\Program Files (x86)\NVIDIA Corporation\PhysX\Common;C:\Program Files\Git\cmd;C:\Program Files\Docker\Docker\resources\bin;I:\1;I:\1\Scripts;I:\abc\12;I:\abc\12\Scripts;C:\Program Files\WSL\;C:\Program Files\GitHub CLI\;I:\deepseek\resources\runtime\cli\bin;C:\Users\张\AppData\Local\Programs\Python\Python313\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python313\;C:\Users\张\.local\bin;C:\Users\张\AppData\Local\Programs\Python\Python310\Scripts\;C:\Users\张\AppData\Local\Programs\Python\Python310\;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\.dotnet\tools;E:\Microsoft VS Code\bin;C:\Users\张\AppData\Local\Programs\Fiddler;C:\Users\张\AppData\Local\Microsoft\WindowsApps;C:\Users\张\AppData\Local\Programs\Ollama;C:\Users\张\.lmstudio\bin;C:\Users\张\AppData\Roaming\npm;C:\Users\张\.lmstudio\bin；②先判存在再加，避免重复追加；③-replace ';+\$','' 去掉尾部分号再拼，避免出现 ;;。

临时会话那条也加了同样的存在性判断。

### 验证

用变量模拟，不碰真实环境：

```
首次: [C:\A;C:\B;I:\...\bin]
再跑: [C:\A;C:\B;I:\...\bin]
幂等: True
未被机器路径污染: True
```

---

## 4.15 修 macOS 多宿主误拦 + 消除杀软误报

### macOS「清理没有写进全部宿主」

**问题**：ensureHostClean() 用的是 enumeratePatchAiBases({ discover: true }) 扫出来的**全部**宿主，llPatchHostsWritten() 要求每一棵都写全。macOS 上只要同时存在 /Applications 与 ~/Applications 或 npm 装的另一份，其中一棵写不全就永久卡住，而用户实际在跑的那棵可能是好的。

**改法**：只对「当前宿主 + 本轮实际写入的宿主」硬性要求写全，其余发现到的树降级为**只报告不拦截**：

```js
const requiredHosts = (hosts) => {
  const hit = hosts.filter((h) => sameBase(h.aiBase, aiBase));
  return hit.length ? hit : hosts;
};
const extraUnwritten = (hosts) => hosts
  .filter((h) => !sameBase(h.aiBase, aiBase) && h.hostWritten !== true)
  .map((h) => h.aiBase);
```

返回值新增 extraUnwritten 字段，调用方能看到哪些树没写全，但不影响重启。

注意：这一条只排除了「多宿主误拦」这一种可能。如果 Mac 那台的真实原因是补丁 #40 没命中，那条已在 1.1.71c 里修过（第 7 条 pattern）。

### 杀软把整包判成 Backdoor:PHP/Chopper.E!dha

**现象**：包上传 GitHub 后下载，Defender 报毒。

**定位**：MpCmdRun -Scan 指出命中资源是

```
dsh-purge-1.1.71c/skills/redteam/unauth-exploit.md
ThreatID 2147891541 = Backdoor:PHP/Chopper.E!dha
```

该文件 L39 与 L73 各有一句**完整的 PHP 一句话木马**（Redis 未授权写 webshell、MySQL into outfile 写 webshell 的示例），属于菜刀的经典载荷，签名直接命中。

**改法**：把两处字面量换成占位符 <PHP-WEBSHELL-PAYLOAD>，并在旁边说明载荷是什么（php 开标签 + eval 接收 POST 参数 + 闭合），技术要点完整保留，但不再携带可命中的样本串。

**验证**：

```
改前：Scanning ... found 1 threats
改后：Scanning ... found no threats
```

### 说明

skills/redteam/unauth-exploit.md 是上游文件（上游 1.1.71 里逐字节相同），这次改动是本地为规避误报做的内容修改，不是功能变更。

### 补充：从「当前宿主」收紧到「当前宿主 + 本轮实际写入的宿主」

第一版只按 sameBase(h.aiBase, aiBase) 选宿主，等于只看当前那棵。问题是：**本轮写过多棵树时，其它被写过的树若处于半补丁状态，同样是坏事**，不能因为“不是当前宿主”就放过。

pplyPatchesAllHosts() 现在给每棵树记 	ouched（summary.applied > 0 || summary.already > 0 即本轮动过），equiredHosts() 改成：

```js
const hit = hosts.filter((h) => sameBase(h.aiBase, aiBase) || h.touched === true);
```

即：当前宿主 + 本轮实际写入的宿主，全部要求写全；没被本轮碰过的树只报告不拦截。
---

## 4.16 禁用版本切换入口（防止被上游 master 覆盖）

### 问题

面板的版本下拉里出现 1.1.72 · 最新，但上游**从没发过这个 tag**：

| 来源 | version |
|---|---|
| 上游 master 分支 package.json | **1.1.72** |
| 上游 tag 最高 | v1.1.71 |
| release 最高 | v1.1.71 |

lib/update.js 的 listRemoteVersions() 第一项取的是 **master 分支 HEAD 的 package.json**，不是发版 tag：

```js
const stableSha = await remoteHeadSha(STABLE_REF);
const version = await remotePackageVersion(stableSha, STABLE_REF);
add({ ..., label: ${versionLabel(version, "stable", stableSha)} · 最新, latest: true });
```

**风险**：用户点它 → 从 master 下载 → 覆盖插件目录 → {{cwd}} 崩、#40 不命中、换包助手自杀全部回来。

### 改法（两层）

**服务端** handleUpdateOp() 开头拦截：除 check / status / ersions 三个只读操作外，一律返回

```json
{ "ok": false, "disabled": true, "error": "本地兼容包已禁用版本切换（会覆盖 1.1.71c 的修复）。升级请手动替换插件目录，见 INSTALL.md。" }
```

覆盖 switch / ollback / channel / uto / 默认 pply 五条路径。

**前端** client.js 的 enderEdition() 直接 eturn null，版本下拉不再渲染。

### 验证

四条切换路径全部返回 ok=false disabled=true：

```
switch   -> ok=false disabled=true
apply    -> ok=false disabled=true
channel  -> ok=false disabled=true
auto     -> ok=false disabled=true
```

client.js 499,297 B，
ode --check exit 0。

### 升级怎么办

不走面板，按 INSTALL.md 手动替换插件目录。这样升级是**人的明确动作**，不会误点。

---

## 4.17 修 #138：0.2.1-rc.2 上红队预设注册失败

### 现象

红队模式在模式下拉里显示为损坏、选不中。preset-declare.json 里：

```json
{ "ok": false, "phase": "registered-broken",
  "broken": "tool-subagent: toolFilter is no longer supported; ..." }
```

### 根因

宿主 @deepseek-ai/dsh-tool-subagent@0.2.1-rc.2 在 pply() 开头加了硬拦截（lib/index.js:355）：

```js
for (const field of ["persona", "toolFilter"])
  if (Object.hasOwn(config, field))
    throw new Error(	ool-subagent: \ is no longer supported; ...);
```

**只要键存在就抛错，与值无关。** 后果不是单点失效，而是**整个预设注册失败** —— 33 个插件行全部装不上，红队模式直接从下拉消失。

### 改法（两处，缺一不可）

**① 包内模板** presets/redteam/agent.cordis.yml：删掉 	oolFilter 整段。叶子约束改由同行的 maxDepth: 1 承担 —— 子代理拿不到再下一层，派发链在深度上断掉，效果等价。

**② 老用户自愈** lib/redteam/index.js：epairDelegation() 加 stripToolFilter()。预设是「包内模板 + 首次使用时复制到 %USERPROFILE%\.dsh\.agent-presets\redteam\」的两层结构，**只改模板的话老用户那份照样崩**。

stripToolFilter() 逐行找 	oolFilter: 键，把它连同所有缩进更深的子块整段删掉，同级的 maxDepth 等配置不动。

### 日志

epairDelegation() 现在多返回 droppedToolFilter 标记，日志能区分两种修复：

```
已移除 toolFilter（0.2.1 起该字段会让整个预设注册失败，叶子约束改由 maxDepth 承担）
```

epaired 字段也多了 drop-tool-filter 值。

### 验证

六项副作用核查全过：

| 项 | 结果 |
|---|---|
| 全包扫 	oolFilter: 键 | 零命中（只剩注释） |
| stripToolFilter 定义/调用 | 各一处 |
| 改动规模 | index.js +41/−0、yml +8/−12 |
| 九文件语法 | 全 exit 0 |
| --status 实跑 | 71/82、0 待清洗、退出码 0 |
| 其它地方依赖该字段 | 无 |

**真实备份数据验证**（不是模拟数据）：拿改之前的 394 行旧预设跑自愈 → 388 行（正好删 6 行）、YAML 仍可解析、	ool-subagent.config 只剩 ackgroundMode / maxDepth / modelSelectionSettings / provider / toolName、**插件行数 33 不变**（确认没误伤相邻配置）。

### 补充

	oolFilter 的 deny 语义在预设 YAML 层已经做不到 —— 	ools.restrict() 需要 scoped context（gent.ctx），不能写在插件 config 里。若将来确实要遮蔽 subagent_fork / workflow / alph，得在 Agent Preset 的工具插件配置或运行时注册里做。
