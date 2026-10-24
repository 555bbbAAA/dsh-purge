# dsh-purge 在 Linux 上

> 版本：1.1.73（Linux 适配版）
> 基线：上游 1.1.71 + 社区兼容包的全部本地修复 + Linux 支持
> 目标宿主：dsh-desktop（Electron），支持 AppImage、解包目录、deb/rpm 三种安装形态

---

## 一、支持情况

| 功能 | Linux | 说明 |
|---|---|---|
| 打补丁（核心） | ✅ | 文本替换，与平台无关 |
| asar 解包 / 重打包 | ✅ | `app.asar` 与 `app/` 目录两种形态都支持 |
| 宿主定位 | ✅ | 三条路径，见下 |
| 进程枚举与终止 | ✅ | `ps -Ao pid=,command=` + SIGTERM → SIGKILL |
| 宿主重启 | ✅ | `spawn(execPath, argv, { detached: true, stdio: "ignore" })` |
| 升级标记 | ✅ 解包安装 / ⏭ AppImage | AppImage 单文件分发，升级即替换整个文件，标记无法预置 |
| 静默闪窗（7 个函数） | ⏭ 跳过 | Linux 无 cmd 窗口概念 |
| 窗口前台化 | ⏭ 跳过 | 由窗口管理器处理 |
| 官方更新握手（wscript） | ⏭ 跳过 | NSIS 专属，Linux 无对应物 |

### 宿主定位的三条路径

1. **运行中进程** —— 读 `/proc/<pid>/exe` 符号链接拿真实二进制，同时读 `/proc/<pid>/cmdline` 抓 AppImage 原始路径（AppImage 运行时 `exe` 指向 `/tmp/.mount_XXX` 的解包副本，`cmdline` 里才是原始 `.AppImage`）
2. **安装目录** —— `/opt`、`/usr/lib`、`/usr/local/lib`、`/usr/share`、`~/.local/share`、`~/.local/opt`、`~/Applications`、`~/Downloads`、`~/Desktop` 乘以常见包名，加上 `DSH_HOME` / `DSH_BASE` 上跳两级。**不做全盘扫描**
3. **`.desktop` 文件** —— `/usr/share/applications`、`/usr/local/share/applications`、flatpak exports、`~/.local/share/applications`，解析 `Exec=` 行

---

## 二、安装

### 方式 A：作为 dsh 插件（推荐）

```bash
# 假设插件目录放在 ~/dsh-plugins/dsh-purge
dsh plugin --profile desktop add file:~/dsh-plugins/dsh-purge
```

或者手工装配：在 `$DSH_HOME/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里追加 `"dsh-purge"`，`dependencies` 写 `"dsh-purge": "file:~/dsh-plugins/dsh-purge"`，然后在 `node_modules` 建符号链接指向源码目录。

### 方式 B：独立 CLI

```bash
cd ~/dsh-plugins/dsh-purge
node bin/dsh-purge.js --status
```

---

## 三、验证（只读，不改任何文件）

```bash
export DSH_SURFACE=desktop
export DSH_BASE=/path/to/resources/app/dsh/node_modules/@deepseek-ai

node bin/dsh-purge.js --status
```

预期输出里应能看到：

```
宿主 / surface   desktop
桌面安装         /opt/deepseek-harness/deepseek-harness      ← 或你的实际路径
插件根 / root    /path/to/@deepseek-ai
补丁 N/82 已清洗, M 待清洗
shim: dsh.cmd=...  dsh.ps1=...  dsh=...
```

**关键判断点**：

- `桌面安装` 那一行必须能定位到你的宿主可执行文件。定位不到时用 `DSH_BASE` 手动指定插件根，或用 `DSH_SURFACE=web` 走 web 面
- `补丁 N/82` 的 N 是已打上的数量，首次运行前应该是 0 或少量

如果 `桌面安装` 为空，先确认宿主路径：

```bash
# 找运行中的宿主
ls -l /proc/*/exe 2>/dev/null | grep -i deepseek

# 找安装目录
ls -d /opt/deepseek-harness ~/.local/share/deepseek-harness ~/Applications/*.AppImage 2>/dev/null
```

---

## 四、应用补丁

```bash
node bin/dsh-purge.js --apply
```

它会：

1. 定位宿主与插件根
2. 备份将修改的文件（`<文件>.dshpurge.bak`）
3. 逐条打补丁，输出 `exact` / `skipped` / `missing` 统计
4. 需要重启时提示

**注意**：`--apply` 会改写宿主安装目录下的文件。AppImage 挂载点是只读的，必须先把 AppImage 解包或用 `--appimage-extract` 展开到可写目录再打补丁。

---

## 五、已知限制

### 1. 官方升级后需要手动重打补丁

Windows 上有 `official-update.wscript` 自动处理：杀进程 → 挪目录 → 恢复 asar → 跑 NSIS 安装器 → 校验 → 回滚。Linux 上没有对应机制，因为：

- 没有 NSIS 安装器（AppImage / deb / rpm 各有各的升级方式）
- 没有 `taskkill.exe`、WScript、ActiveX

**Linux 上升级宿主后，需要手动跑一次 `--apply`。**

### 2. AppImage 是只读挂载

AppImage 运行时挂载在 `/tmp/.mount_XXX`，该目录只读。要打补丁有两种做法：

```bash
# 做法一：解包后运行解包版
./DeepSeek_Harness-0.2.1.AppImage --appimage-extract
cd squashfs-root && ./deepseek-harness

# 做法二：解包到固定目录，打补丁，之后都用解包版
mkdir -p ~/dsh-unpacked && cd ~/dsh-unpacked
~/Downloads/DeepSeek_Harness-0.2.1.AppImage --appimage-extract
node ~/dsh-plugins/dsh-purge/bin/dsh-purge.js --apply
```

### 3. shim 相关功能仅 Windows

`dsh.cmd` / `dsh.ps1` 是 Windows 的命令行 shim，Linux 上会显示 `missing`，属正常。

---

## 六、与 Windows 版的差异

| 项 | Windows | Linux |
|---|---|---|
| 宿主定位 | 注册表 + Win32_Process + .lnk | /proc + 固定安装根 + .desktop |
| 进程终止 | `taskkill /F /PID` | SIGTERM → 8 秒 → SIGKILL |
| 重启 | `spawn` + 窗口前台化三重 trick | `spawn` detached，窗口交给 WM |
| 官方升级握手 | wscript + NSIS | 无，需手动 `--apply` |
| 闪窗抑制 | 7 个函数 | 无（无此问题） |

---

## 七、故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `桌面安装` 为空 | 宿主没运行且不在常见安装路径 | 用 `DSH_BASE` 指定，或先启动宿主让 `/proc` 能读到 |
| `插件根 / root` 显示 missing | `DSH_BASE` 没指向 `@deepseek-ai` 目录 | `export DSH_BASE=/path/to/resources/app/dsh/node_modules/@deepseek-ai` |
| 补丁全部 `missing` | 宿主版本与补丁锚点不匹配 | 检查宿主版本，补丁锚点是逐字符匹配的 |
| `--apply` 报 EACCES | AppImage 挂载点只读 | 先 `--appimage-extract` 解包 |
| 打完补丁没效果 | 宿主没重启 | `--apply` 后手动重启宿主 |

---

## 八、回滚

```bash
node bin/dsh-purge.js --revert
```

它会把所有 `.dshpurge.bak` 还原回原文件。也可以手动：

```bash
find /path/to/host -name "*.dshpurge.bak" | while read f; do mv "$f" "${f%.dshpurge.bak}"; done
```
