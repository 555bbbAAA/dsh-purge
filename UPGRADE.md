# dsh-purge 1.1.71c 安装与升级指南

> 适用：dsh-desktop 0.2.0-rc.2 → 0.2.1-rc.2（Windows / Linux）
> 两种人看不同的章节：**从零安装**看第 1 节，**从旧版升级**看第 2 节起。

---

## 0. 先搞清楚你在哪种状态

打开应用，跑：

```bash
dsh-purge --status
```

看「桌面安装」和「插件根」两行。

再看安装目录里有没有 `app.asar`：

| 你看到的 | 状态 | 含义 |
|---|---|---|
| `resources\app.asar` 存在 | **密封** | Electron 加载压缩包，补丁会被遮蔽 |
| 只有 `app.asar.bak` 或 `app.asar.0.2.1-official` | **已换包** | Electron 加载 `resources\app`，补丁生效 |
| 有 `app.asar` **和** `app` 目录 | **密封优先** | asar 存在时 Electron 优先用 asar，补丁仍被遮蔽 |

---

## 1. 从零安装

### 1.1 装插件

三选一：

```bash
# 方式 A：用 dsh 的插件管理
dsh plugin --profile desktop add file:/path/to/dsh-purge

# 方式 B：手工装配（改 profile/package.json 的 bundles 与 dependencies）

# 方式 C：应用内的插件管理界面
```

### 1.2 应用

```bash
dsh-purge --apply
```

如果检测到 asar 密封，它会自动解包 → 打补丁 → 换包 → 重启。

### 1.3 万一卡住

见第 6 节。

---

## 2. 升级：为什么必须先换插件，再升宿主

**这一步反了会掉进自己爬不出来的坑。**

宿主升到 0.2.1 之后，旧的 1.1.71 每轮都会抛：

```
unknown prompt variable "{{cwd}}"
```

后果不是某个功能坏了，而是**整轮请求失败**——应用里的 AI 一句话都说不出来。

而这时候你恰恰最需要它帮你跑命令。

**所以顺序必须是：先把插件换成 1.1.71c（此时宿主还是 0.2.0），确认能用，再升级宿主。**

---

## 3. 升级前备份

| 备份什么 | 位置 | 为什么 |
|---|---|---|
| `prompt-inject.md` | profile 目录 | 你自己的提示词，升级不会删它，但先留一份 |
| `package.json` | profile 目录 | 记录装了哪些插件 |
| 整个 profile 目录 | `%DSH_HOME%\profiles\desktop` | 求稳就整份拷走 |

`%DSH_HOME%` 默认是 `C:\Users\<你>\.dsh`，装了桌面版通常在独立目录（例如 `I:\deepseek-data\dsh`）。

**安装目录里的 `app.asar.bak` 不用备份**——升级后会重新生成。

---

## 4. 第一步：换插件（宿主先别动）

用 1.1.71c 覆盖旧的插件目录，然后**重启应用**（宿主还是 0.2.0）。

验证三件事，全部通过才继续：

```bash
# ① 应用能正常打开
# ② 状态能跑出两行定位
dsh-purge --status

# ③ 跟 AI 说句话，它能正常回
```

**1.1.71c 在老宿主 0.2.0 上可用**——`dshTarget` 写的是 `0.2.1-rc.2（兼容 0.2.0-rc.2）`，老形状的补丁 pattern 都还在表里。

---

## 5. 第二步：升级宿主

1. **完全退出应用**（含托盘图标）
2. 跑官方 0.2.1 安装包
3. 装完**先别急着点「应用」**

升级后的状态：

```
resources\app.asar          ← 全新的 0.2.1（密封）
resources\app\              ← 旧的 0.2.0（打过补丁，会被重新解包覆盖）
resources\app.dshpurge-prev ← 更早的一份（如果有）
```

**补丁全丢了是正常的**，不是故障——宿主文件被换新了。

---

## 6. 第三步：先看状态，再动手

打开应用：

```bash
dsh-purge --status
```

重点看两行：

| 字段 | 期望 | 如果为空 |
|---|---|---|
| **桌面安装** | 指向 `...\DeepSeek Harness.exe` | 确认安装路径，或用 `--exe` 指定 |
| **插件根** | 指向 `...\resources\app\dsh\node_modules\@deepseek-ai` | 设 `DSH_BASE` 环境变量 |

这时候补丁数应该是 0 或很低。**正常。**

---

## 7. 第四步：应用

```bash
dsh-purge --apply
```

预期过程：

```
检测到 asar 密封
  → 重新解包（旧 app/ 改名成 app.dshpurge-prev-<时间戳>）
  → 备份 + 打补丁
  → 换包：杀应用 → app.asar → app.asar.bak → 重新打开
```

重开后跑 `--status`，补丁数应该上去。

---

## 8. 卡住了怎么办

按从轻到重试三条。

### 路线一：命令行换包

```bash
# 完全退出应用（含托盘），然后
dsh-purge --swap-asar
```

它会检查应用是否真的关了、把 `app.asar` 改成带时间戳的备份名、再启动应用。

### 路线二：手动改名（不需要任何工具）

打开资源管理器，进到安装目录的 `resources\`：

```
把  app.asar  改名成  app.asar.bak
重新打开应用
```

改完 Electron 找不到 asar，就会加载 `resources\app`，补丁立即生效。

**这是最后的保底，不依赖 node、不依赖命令行。**

### 路线三：看日志定位

| 日志 | 位置 | 看什么 |
|---|---|---|
| 换包分步日志 | `%TEMP%\dsh-purge-asar-swap.log` | `start / kill-round-1 / kill-round-2 / before-move / moved-ok` 五步，死在哪步 |
| 启动器日志 | `%TEMP%\dsh-purge-asar-launch.log` | schtasks 启动是否成功 |
| 内部日志 | `%TEMP%\dsh-purge-desktop.log` | 补丁与注入的详细过程 |

---

## 9. 清理：`dshpurge-prev` 会累积

每次重新解包，旧的 `resources\app` 会被改名成 `app.dshpurge-prev`（已存在则加时间戳）。

**每份约 300 MB。** 升级几次就会占掉一两个 GB。

清理办法：确认应用能用之后，删掉这些目录，**保留最新一份**做回滚：

```
resources\app.dshpurge-prev            ← 保留（最近一次回滚点）
resources\app.dshpurge-prev-<时间戳>   ← 可删
```

---

## 10. 副作用：旧的 `app.asar.bak` 会被覆盖

换包脚本会先删掉已存在的 `.bak` 再移动。

那是上一版的 asar。升级到新版本之后它没有回滚价值——真要回滚应该重跑旧安装包——所以覆盖掉不影响。

---

## 11. 平台差异

| 项 | Windows | Linux |
|---|---|---|
| 宿主定位 | 注册表 + 进程 + 快捷方式 | `/proc` + 固定安装根 + `.desktop` |
| 进程终止 | `taskkill` | SIGTERM → SIGKILL |
| 换包（asar 挪开） | 支持（schtasks 启动助手） | 不适用 |
| 官方升级后自动重打 | 需手动跑一次 `--apply` | 同左 |

Linux 的详细说明见 `LINUX.md`。

---

## 12. 命令速查

```bash
dsh-purge --status       # 看状态（只读，不改任何文件）
dsh-purge --apply        # 打补丁
dsh-purge --revert       # 回滚补丁
dsh-purge --swap-asar    # 离线换包（应用关闭时执行）
dsh-purge --uninstall    # 卸载插件
dsh-purge --edit         # 编辑注入了 prompt-inject.md
dsh-purge --help
```

`--swap-asar` 的开关：

```bash
--no-start    # 只换包，不自动打开应用
--exe <路径>  # 手动指定桌面端可执行文件
```

---

## 13. 常见问题

**Q：点「应用」后应用崩了，提示「应用无法启动或已意外停止」**

补丁打好了但 asar 没挪开。走第 8 节路线二：把 `app.asar` 改名成 `app.asar.bak`，重开应用。

**Q：报「清洗没有写进全部宿主，已取消重启」**

补丁没全部打上，重启被闸门拦住了。先跑 `--status` 看哪几条是 `skipped` / `missing_file`。

`missing_file` 通常是对应的包被宿主删了（版本差异），不影响功能。

**Q：补丁数一直是 0**

asar 还在密封状态。看第 0 节判断，然后走第 8 节。

**Q：升级后 AI 不说话，一直报错**

旧的 1.1.71 还在用，`{{cwd}}` 每轮抛错。换成 1.1.71c。

**Q：`--status` 里「插件根」是空的**

环境变量 `DSH_BASE` 没设，或者设置的路径不对。它应该指向 `...\resources\app\dsh\node_modules\@deepseek-ai`。

---

## 14. 版本对照

| 版本 | 说明 |
|---|---|
| 1.1.71 | 上游基线，只适配 0.2.0-rc.2 |
| 中间版本号（未发布） | 已作废，不再使用 |
| **1.1.71c** | 当前发布的社区兼容包，适配 0.2.1-rc.2，兼容 0.2.0-rc.2 |

版本号保持 `1.1.71` 前缀 + 字母后缀，是为了标明这是社区维护的兼容包，不与上游版本线混用。
