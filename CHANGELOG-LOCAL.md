# dsh-purge 更新日志

社区兼容包，当前版本 **1.1.102**，目标宿主 dsh-desktop **0.2.1-rc.3**。本文件只记录我们这条维护线（1.1.71c 起）的变更。

## 1.1.102（2026-10-24）

- 补充 1.1.101 的判据：只要「需要解包 asar」（esources\app\package.json 不存在）就不在开机做，跟是不是全新安装无关 —— 因为老机器上 pplied.json 会一直存在，光判「首次安装」挡不住 182MB 解包。现在开机只做检查更新，解包/打补丁统一交给用户点「应用」。
## 1.1.101（2026-10-24）

- 开机不再挡官方更新：`autoApplyOnStart` 在「全新密封安装」上要解包 182MB asar + 打 70 个文件，全是同步重活，撞上 dsh 更新器的「优雅退出」（10 秒 deadline）就会报 `Host did not complete graceful task teardown`。现在启动时的 settle 会先判断两种情况并跳过：①官方更新正在跑（`installer.exe` 在跑或 `dsh-purge-official-restarting` 标记存在）②全新安装（`applied.json` 还没有版本戳）—— 这两种情况下只做「检查更新」，解包打补丁交给用户点「应用」。
## 1.1.100（2026-10-24）

- 换包观察者不再和官方更新抢：①占用判断改用「能不能独占打开 app.asar」，不再依赖 Get-Process.Path（跨完整性级别时读不到 Path，会被误判成没占用）；②检测到官方更新在跑（dsh-purge-official-restarting 标记或 installer* / deepseek-harness* 进程）就退让等待，不再动手；③强杀阈值 15 秒 → 45 秒，且只杀 arm 时刻那个 pid，持有者是之后新起的实例就不杀。修的是实测现场：观察者把正在被更新器问话的宿主杀掉，官方更新报 desktop update: task inspection timed out、弹「安装更新失败」。
## 1.1.99（2026-10-24）

- 新增 `VERIFY.md`：把本轮在 VM 上的端到端验收结论、复验命令、故障对照表、证据文件位置写成一份可照抄的文档，并入包（package.json 的 files 白名单已加）。纯文档，不改行为。
## 1.1.98（2026-10-24）

- 回滚 1.1.97 的「有新版就装」：恢复成只认「宿主 dsh 版本变了」才自动下载+安装+重启；日常启动只检查并提示（面板/candidate 字段），由用户点一下再装。原因：避免正在干活时被自动重启。uto-upgrade.json 的 eason 字段保留（现在恒为 host-changed）。
## 1.1.97（2026-10-24）

- 按 Royan 决定（方案 B）改成「有新版就装」：每次启动都查远端，只要远端有比本地新的 tag 就自动安装并重启一次，不再要求「宿主版本变化」才触发。宿主变没变只影响要不要回写 host_version。uto-upgrade.json 新增 eason（host-changed / oot-check）便于区分触发来源。
## 1.1.96（2026-10-24）

- **观察者脚本的致命笔误**：1.1.91 给它加 -DshHome 参数时，把 param() 里 $LockPath 后面那个逗号弄掉了 → PowerShell 解析失败，观察者一启动就死，于是「lock 留在盘上、日志里连 start 都没有」。这就是 1.1.91 之后换包又不动的原因（1.1.89 那次能成功正因为还没这个参数）。已修，并让脚本每次都能正常解析。
- 观察者启动改为「WMI 优先 + schtasks 兜底」：shcategories 的 /TR 有 261 字符上限，参数多会超，改成先写一个 .cmd 包装；没有提升令牌时 /RL HIGHEST 会「拒绝访问」，会自动去掉它重试一次。
- 本机实测：armed → 15 秒内 pp.asar 变 pp.asar.bak，idle 日志出现 start pid=... 与 elaunch with DSH_HOME=...。
## 1.1.95（2026-10-24）

- 按 Royan 决定把 #71（梁神预设身份句）与 #80（极简预设工具表）再次退役：目标预设本机不装，留着也只是 na，列表求干净。补丁表 78→76，na 8→6，可打仍是 70 条；退役理由已写进 RETIRED_PATCH_IDS 上方注释，随时可放回。
## 1.1.94（2026-10-24）

- 把 #71（LIANGSHEN_IDENTITY_LINE，梁神预设去掉官方身份句）与 #80（MINIMAL_OFFICIAL_TOOLSET，极简预设恢复官方工具表）放回补丁表：这两条是「目标预设没装」型，属于条件性休眠，应当显示 na 而不是被退役。补丁表 76→78，na 6→8，可打的仍是 70 条。
- 仍保持退役的四条（rc.3 上游原文消失）：#32/#53（web 身份段与禁令被重写）、#56/#77（rewind 可见性重写）。
## 1.1.93（2026-10-24）

- 换包链路的诊断落盘：新增 `%TEMP%\dsh-purge-watch.log`，记录「armed（含 exe/asar/DSH_HOME/脚本路径）」「WMI 创建观察者的结果」「失败原因」；观察者自己的 `dsh-purge-asar-rename-idle.log` 记 start 与「卡住 15 秒强杀」。无控制台环境里 console.warn 看不到，只能靠这两份文件定位断点。
## 1.1.92（2026-10-24）

- 观察者启动失败的真因：`-DshHome ""` 这样的空参数拼进 WMI 的 CommandLine 会被拆坏，`Win32_Process.Create` 直接失败 —— 症状是 lock 留在盘上、日志里连 `start` 那行都没有。改成只有 `DSH_HOME` 非空时才追加该参数。
## 1.1.91（2026-10-24）

- 换包重启会丢环境：观察者 `Start-Process ` 时不再继承启动时的 `DSH_HOME`，换包后新实例会跑回默认 home（换台机器就等于插件不在、面板 404、用户数据也不对）。现在把 `DSH_HOME` 作为 `-DshHome` 传进脚本，重启前显式设回环境变量并写日志。
## 1.1.90（2026-10-24）

- 真因：`/dsh-purge/apply` 从来没排过换包。`asar_swap_started` 只是 `shouldRestart && handoff && sealedNow` 算出来的布尔值，而 `core.scheduleSealedDesktopRestart` 全仓库只有 `reapply.js` 调过 —— 所以点「应用」时 if 条件成立、返回值很漂亮，实际既没观察者也没人改名，asar 一直不动、补丁永远不生效。现在 apply 里真的调一次排程，并把结果放进 `asar_swap` 字段。
## 1.1.89（2026-10-24）

- 换包观察者补「卡住就动手」：等 app 退出超过 15 秒（30 次轮询）就直接结束占用 app.asar 的进程，再改名并重新拉起；同时补 `` 初值与 `Write-Log`（日志写到 %TEMP%\dsh-purge-asar-rename-idle.log）。原因是「优雅退出」会顺带把新实例拉起来，新实例立刻又锁住 asar，观察者永远等不到空闲，asar 就永远不挪。
## 1.1.88（2026-10-24）

- 密封态换包改走确定性路径：`scheduleAsarSwapRestart` 在 Windows 上先用 WMI 观察者（`scheduleAsarRenameWhenIdle`）+ 优雅退出，老的三条路（PS1 直接 spawn、schtasks、restart-desktop.js helper）在会话 0 无控制台环境里实测都没落地 —— apply 返回 `asar_swap_started: true`，但既没有守护进程也没有 swap 日志，asar 一直不挪，表现就是「面板说打好了、实际还读归档」。
## 1.1.87（2026-10-24）

- 自动升级后的重启以前是空操作：调用 `hostctl.scheduleRestart(null, ctx, { openBrowser: false })`，而 `desktop.scheduleRestart` 见到 `openBrowser: false` 直接 return（那条守卫本来是给启动自检用的）。结果 asar 被占用时只挂了个 rename-pending，app 一直不退出，换包永远不落地（VM 实测：upgraded_to 1.1.86、asar_sealed=true、swap_pending=true、进程还是 20:58 那批）。改成不带 `openBrowser: false` 的重启，并在 swap_pending 时也照常重启。
## 1.1.86（2026-10-24）

- 修 `auto-upgrade.json` 的 `plugin_version_before` 读取时机：以前是装完之后才读 `localVersion()`，所以永远等于目标版本；改成调 `autoUpgradeForHost` 之前取一次。
## 1.1.85（2026-10-24）

- `auto-upgrade.json` 增加 `candidate`（这次算出来的目标版本）与 `plugin_version_after`，把「算出来要升哪版 / 实际落成哪版」记在一起。
## 1.1.84（2026-10-24）

- `/dsh-purge/status` 增加 `candidate`：按当前远端候选与本地版本算出「自动升级会升到哪一版」。挑版本出错时（比如只装了最旧的那个新版本）在状态里就能看出来，不用去猜。
## 1.1.83（2026-10-24）

- `auto-upgrade.json` 补充 `host_install`（宿主安装目录）与 `asar_sealed` / `swap_pending` 两个状态位，方便一眼看出「升级后换包有没有跟上」。
## 1.1.82（2026-10-24）

- 版本源改用 GitHub atom 兜底：`listGithubAtomTags()` 读 `tags.atom` / `releases.atom` 里的 `<title>v1.1.x</title>`，与 GitHub API 的结果合并去重。jsDelivr 的 data 接口对这个仓库直接 500，raw.githubusercontent 在 VM 里超时，atom 这条通。
- 挑版本抽成纯函数 `pickNewestTag(versions, local)` 并补单测：候选里混入 master、裸 sha、乱序版本时，必须选中「比本地新里最高」的 tag；本地已最新时返回 null。selftest 17 项。
## 1.1.81（2026-10-24）

- 版本源加 jsDelivr 兜底：`listJsdelivrTags()` 读 `data.jsdelivr.com/v1/package/gh/<repo>` 的 tag 列表，与 GitHub API 的结果合并去重。现场：VM 里 api.github.com 的 tags 接口 403、raw.githubusercontent 超时，于是 tag 列表为空/很旧，自动升级永远认为「没有新版」；jsDelivr 那条路同期返回 master package.json = 1.1.80，可用。
## 1.1.80（2026-10-24）

- 自动升级结果落盘：`<DSH_HOME>/dsh-purge/auto-upgrade.json` 记录当次的宿主版本、升级前插件版本、是否 applied、跳过原因、远端候选数、升到哪一版。以前这些只打在宿主控制台里，VM 上根本抓不到，排查只能靠猜。
## 1.1.79（2026-10-24）

- 启动早期拿不到远端 tag 列表时，不再把宿主版本记成「已对齐」：`autoUpgradeForHost` 增加 `remoteCount`，为 0 时索引侧返回 `auto-upgrade-remote-unavailable` 并留到下一轮再试。之前一次网络抖动就会让这次自动升级永久放弃（VM 上实测过：boot 阶段 noop 且 host_version 已写 rc.3）。
## 1.1.78（2026-10-24）

- 自动升级取错版本：`autoUpgradeForHost` 的排序比较器写反（`versionIsNewer(a,b) ? 1 : -1` 是升序），于是每次都装「比本地新的里面最旧的那版」。VM 实测：本地 1.1.74、远端有 1.1.77，结果只升到 1.1.75。改成降序取最高版本。
- VM 验证：直调 `autoUpgradeForHost` 返回 applied=true 但 to=1.1.75，正是这条 bug 的现场证据。
## 1.1.77（2026-10-24）

- 退役 #56 REWIND_HIDE_CUT_ONLY：0.2.1-rc.3 把 rewind 可见性那段代码整体重写了，conversation-client 里既没有 `hidden.add(event.seq)` 也没有 `rewindVisibleEntries`，只剩两段可匹配 —— 强打会把调用插进去而函数不存在。定义留在源码里，补丁表 77→76；VM 上 pending 从 1 归零。
- 版本自检：tag v1.1.77 内的 package.json version = 1.1.77，release 资产用同一份源码重打。
## 1.1.76（2026-10-24）

- 观察者只保留 WMI 一条启动路径：1.1.75 同时用 detached spawn 和 WMI 各起一份，会变成两个观察者抢着改名并各自 Start-Process，可能拉起两个实例。现在只走 WMI，失败时记日志并把 `launchFailed` 带回。
## 1.1.75（2026-10-24）

- 换包静默失效的真因修掉：`ASAR_RENAME_WHEN_IDLE_PS1` 原先在开工前看 `%TEMP%\dsh-purge-official-restarting`，45 秒内直接 exit 0。那个标记属于「官方更新接管」，与本观察者无关——官方重启的尾巴还在时它就空跑，app.asar 永远不被挪走，于是「补丁写进 resources\app、Electron 仍读归档、面板显示已打却没生效」。已删掉该早退，进程占用判断改成 `-ieq`。
- 观察者改用 WMI 创建（`launchDetachedViaWmi`）：Electron 主进程带 job object（KILL_ON_JOB_CLOSE），`detached:true` 的子进程会随父进程一起被收掉；而换包观察者恰恰要「等 app 退出才干活」，结果 app 一退它也死了。改由 WmiPrvSE 创建后生命周期与作业对象无关。本机实测：armed 之后父进程退出，10 秒内 app.asar 被改名为 .bak、锁标记清掉。
- `/dsh-purge/status` 增加 `swap_pending`：`app.asar.rename-pending` 存在即代表「补丁已写、换包未完成」，错配状态可见，不再只靠 `asar_still_sealed` 猜。
- 新增 `scripts/vm-verify.ps1`：一次性验证脚本（宿主/插件版本、applied·pending·asar_sealed·swap_pending、非 applied 的补丁编号、安装目录 asar 清单、日志尾）。

## 1.1.74（2026-10-24）

- 自动升级成功后立刻回写 `host_version`：1.1.73 只在不升级的分支写，导致升级完下一轮启动还会以为宿主又变了。
- 自动升级后把「解包 + 打补丁 + 换包 + 重启」一次做完（调 `reapplyInstalled({ scheduleSwap: true })`）：密封 asar 时补丁写在 `resources/app`，Electron 却仍读 `app.asar`，只升级不换包就会出现「面板显示 70/77 实际没生效」的错配。reapply 自己排过换包重启时不再重复排一次。
- 安装路径指针只写存在的目录（`rememberDesktopInstallForHandoff`），读取时也校验：路径被卸载、盘符变了或历史上被解码坏过，就当没这条指针，不再拿假路径去定位宿主。
- 验证：16 项自检全过；VM 里 rc.2→rc.3 的自动升级链已跑通（见 1.1.73），本轮补的是升级后的收口。

## 1.1.73（2026-10-24）

- 新增宿主版本识别：`lib/host-version.js` 直接读 `resources/app/package.json`；密封态下解析 `app.asar` 头里的 `package.json`（新增 `extract-asar.readAsarEntryText/Buffer`），不依赖 node:fs 进归档。
- `applied.json` 新增 `host_version`；`reapply.recordHostVersion()` 可在不改 sha/identity 的前提下单独更新它。
- 官方升级 dsh 并重启后，插件自动对齐：启动流程比对记录的 `host_version` 与当前版本，变了就去远端取一版更新的插件（只认 tag）装上，然后按官方流程重启；第一次只记录、不升级；没有新版或任何一步失败都只记日志，不影响启动、不循环。开关 `autoUpdatePluginOnHostChange`（默认开）。
- 新增 `update.autoUpgradeForHost()`：列出远端 tag → 只留比本地新的 → 下载既有 `applyUpdate` 流程 → 返回 `upgradedFrom/upgradedTo`。

### 1.1.72 及之前

## 1.1.72（2026-10-24）

### 审计修复（2026-10-24 夜，VM 验证批次）

只读审计查出三类问题，本批全部按源码修掉，版本号仍守 1.1.72：

- 备份被误刷（最严重）：`refreshStaleBaksForUpgrade` 原判据是「当前文件里没有 `dsh-purge` 字串就当它是官方新版」，而 22 条补丁的替换文本本身不含这个字串，结果把唯一一份原始备份覆盖成已打补丁的字节，revert 从此跳过这些文件。本机实测 52 个 `.dshpurge.bak` 里 50 个已与当前文件逐字节相同。现在判据改为「宿主构建身份」（各包 `name@version` 的 sha1），身份没变或没有 applied 戳时一律不动 bak；`applied.json` 新增 `host_identity` 字段。
- 多文件补丁的失败被掩盖：`rollupPatchStatus` 里 `applied > 0` 会盖掉 `write_error / backup_failed`，apply 会对着半成品盖「已应用」戳。现在 `lastError` 优先于 `applied`。
- shim 注入一直是死的：`isTextShim` 走的是 `hostFs`，而它没有 `readSync/closeSync`，函数永远返 false，`dsh.cmd` 这种纯文本被判成 `binary`，DSH_HOME 固定注入从未写过，每次状态查询还漏一个 fd。改用 `nodeFs`。
- CLI 在桌面版布局下找不到插件根：普通 node 进程里 `detectSurface()` 只会给 web，`--status` 报「插件根未找到 / 0/77」并逐行 `undefined`，`--apply` 直接退出，`--revert` 跳过还原却打印「回滚完成」，`--uninstall` 会删插件把补丁留在宿主里。现在 `findAiBase()` 在 web 解析落空时回落到桌面版（`discover=true`），并把安装目录钉进 `DSH_DESKTOP_INSTALL` 让 `desktop-shell` 等目标一并解析；`--revert / --uninstall` 找不到根时直接报错退出，不再假成功。
- `/redteam/api` 的来源校验形同虚设：`if (loopback) return true` 让任何网页的请求都跳过 Origin 检查（实测跨站 POST 回 200）。改为按 Host 判定：只有本机回环 Host 才认浏览器来源，非回环 Host 只放行不带 Origin 的非浏览器客户端；`Origin: null` 一律拒绝。`/dsh-purge/*` 同步加了非回环 Host 的限制，堵 DNS rebinding。
- `/dsh-purge/continue` 服务端从未注册，而客户端每 1.2 秒轮询一次、「继续」按钮永远 disabled。补上 GET/POST 路由，接到 `continue-retry` 的 `inspectTurn / sendContinue`。
- rules / skills 路由的 GET 能触发写：两个分支的方法白名单参数一模一样，`op` 又能从路径尾段或 `?op=` 取。现在读操作白名单（`status/scan/scan-read`）以外一律要求 POST。
- 其它：JSON 解析失败回 400、超长 body 回 413（以前都是 500 带引擎原文）；`sendJson` 幂等，卸载流程二次写响应不再 `write after end`；预发布版本比较改为按段数值比（`rc.10 > rc.9`）；`localSha` 不再把 `apply:1.1.72` 截成 `apply:1`；`extractAsar` 文件条目补上解包目录包含性检查；`prompt-inject.md` 改原子写；`restoreMissingOriginalsFromBak` 改为扫描全部 `.dshpurge.bak`（不再只认 6 个写死文件名）；`hostFs.promises` 补 `stat/chmod`，权限位保留不再是死代码。
- 新增 `scripts/selftest.mjs`（15 项，纯临时候具，不碰真实宿主）：`node scripts/selftest.mjs`。

### 第三轮（同夜，新增修复能力，不动真实宿主）

- 新增 `dsh-purge --repair-baks`：从官方归档（`resources/app.asar` 或 `app.asar.<ver>-official`）取回原文，重建被旧判据覆盖掉的 `.dshpurge.bak`。只写备份、不碰正式文件；默认只出计划，加 `--write` 才落盘；`--asar <路径>` 可指定归档。判定收在 `lib/repair-baks.js` 的 `classifyBackup()` 里（no-archive-entry / missing-current / no-backup / already-pristine / backup-differs-keep / current-is-official / repair 七种），干净备份和「备份与当前不同」的一律不动。归档读取用新增的 `extractAsarSelected()`，只解需要的条目，不整包解 180 MB。
- 本机计划（只读实测，未写盘）：56 个目标里 47 个可重建，7 个本就干净，2 个备份与当前不同保持原样。

### 第四轮（同夜，红队演练台审计后的修复）

只改包，没有对真实宿主或真实演练库执行任何操作。

- 路径围栏（审计最严重的几处）：`RedteamStore.dirOf()` 现在校验 engagement id（拒绝 `..`、分隔符、控制字符，并过 `assertPathWithin`），以前 `{"op":"prompts","engagement":"../../../foo"}` 能在 redteam 根外建目录写文件；`deletePoc` 的 `startsWith` 换成带分隔符的真实路径判定（以前 `root/pocs-backup` 能通过前缀检查被递归删除）；`updatePoc` 的落盘路径补上 `assertPathWithin`；`addShot` / `addAttackFile` / `savePoc` 从 `path` 读源文件时只允许靶标目录、数据根与系统临时目录（以前传绝对路径就能把 `~/.ssh/id_rsa` 拷进 shots/ 再读出来）。
- `skillRead` 的 `name` 只接受 `[A-Za-z0-9._-]`（以前 `../../...` 可读任意 `.md`）。
- 修掉上一轮我自己引入的回归：非回环 Host 时要求 Origin 为空，导致用 192.168.x.x 打开面板时所有 POST 被 403。现在按同源判，`Origin: null` 与跨站仍拒。
- 报告里的伪造数字：档位校正段原来写死「面板原始记录值 16180，校正后 16090」，改成按本次 summary 计算的实际合计。
- 复现命令：`buildCurlCommand` 以前完全不读 `options.headers`，抓包里保留的 Authorization / Content-Type 全丢（照抄会 401/415）；cookie 与 URL 也没有转义。现在带头、统一单引号转义。

### 第五轮（同夜，升级链路）

- 面板升级放开到「只认 tag」：`handleUpdateOp` 以前整段禁用，现在 `switch / rollback / apply` 只接受 `v1.2.3` 这类版本 tag，并且必须能在远端 tags 列表里查到；master / beta 分支与裸 sha 仍然拒绝并给出原因。`channel` 只允许改记录不装包，`auto` 继续禁用（启动路径永不自动升）。
- `cordis.patch.yml` 的 `autoApplyOnStart` 由 false 改成 true：官方升级后启动时能自己补一次。桌面 + 密封 asar 仍会走 `skip:sealed-wait-apply`（settle 的跳过逻辑这次没动），也就是密封态照样要点一次「应用」。
- `scripts/selftest.mjs` 增到 16 项（新增「升级只认 tag」）。

### 第六轮（同夜，虚拟机验证工具）

- 新增 `scripts/vm-check.ps1`：在目标机（VM）上一键收集环境、跑 selftest、`--status`、`--diag`、备份完整性统计与 `--repair-baks` 计划、尾部日志，写一份 UTF-8 报告。
  用法：`powershell -ExecutionPolicy Bypass -File scripts\vm-check.ps1 [-OutFile 路径]`。只读，不跑 apply/revert。
  文件必须带 UTF-8 BOM，否则 PowerShell 5.1 按 ANSI 读中文会报 TerminatorExpectedAtEndOfString。

### 第二轮（同夜，收了上一轮未修的项）

- 多宿主去重名存实亡：`enumeratePatchAiBases` / `findAiBaseRecursive` 用 `fs.realpathSync.native`，而 fs 是 hostFs，没有 `.native`，每次抛错退回字符串比较；junction/软链下同一棵树会被当成两个宿主，apply 打两遍、备份互相盖。改走 `nodeFs`。
- apply / revert 没有并发闸：连点两次「应用」或两个标签页同时点会并发写同一批宿主文件。新增 `serializeHostWrite`，`applyPatchesAllHosts` 与 `revertAll` 都从这条串行链过（任务内部不得再进链，否则自锁）。
- 面板 503 单点：`webTreeReady` 只靠 loader.await 落地时两个服务同时就位，竞态失败就永远 503、整块面板不可用到重启。加 15 秒兜底置位。
- GET 仍带写副作用：`GET /dsh-purge/rules?cwd=` 会写 last-cwd.txt。改成只有 POST 落盘。
- `POST /dsh-purge/drill-grant` 无 body、无确认就能永久授权。现在要求 `{accept:true}`。

### 1.1.72 本体

- 官方升级交还官方更新器：#45 的接管只做布局归位（`app.asar` 归位、解包目录改名），自跑安装器的老路改为 `DSH_PURGE_UPDATE_HANDOFF=wscript`
- 换包时序修复：助手先写就绪标记，宿主等到标记再退出，避免 schtasks 约 8 秒启动延迟导致外壳误判 host 崩溃
- 补丁锚点：#47 / #49 / #57 增加结构型与正则兜底，补上 responses 通路的 developer role 白名单，profile 里 pi-ai 1.3.0 副本三条补齐
- 移植两组修复：停用 / 卸载后复位 `selectedDefault`（原 #108）；0.2.1 上红队预设的 schema 封口与 `toolFilter` 清理
- 页面新版本通知：启动后台查一次版本，有新版时右下角提示，开关 `updateCheckOnStart`
- 目标宿主提到 0.2.1-rc.3；版本源与安装源指向 555bbbAAA/dsh-purge
- 仓库清理：移除遗留宣传图、旧设计稿、死文档与 .bak 备份，安装包从 1.5 MB 降到 0.86 MB
- 文案换成本仓库口径：包描述、版本切换提示、INSTALL 示例路径
- 补丁表瘦身：退役 5 条目标已消失的死补丁（#32 #53 #71 #77 #80，定义留在源码与 git 历史），完整表 82→77，面板与命令行统一为同一口径，显示 71/71

## 1.1.71c（2026-10-20，历史）

基于上游 1.1.71 的兼容包：`{{cwd}}` 取值修复、换包链路 #133（job object / .cmd 编码 / .ps1 BOM）、`--diag`、`--fix-shim`、`--swap-asar`、杀软误报处置（Backdoor:PHP/Chopper.E!dha）等。

完整记录（1,029 行）见存档：`I:\工作区\_purge-archive-20261024\CHANGELOG-LOCAL-1.1.71c-1029行.md`
