# 1.3

以 **1.2.12**（实测能完整走通官方升级的那一条线）为基线重建，并补三处时序保护。

## 与上一版本 v1.2.12 的对比

| 维度 | v1.2.12 | v1.3（本版） |
|---|---|---|
| 官方升级路径 | #45 接管：插件归位 asar 后交还官方安装器 | 不变（保留 #45，这是慢机器也能装成的前提） |
| 安装空窗期 | 无保护：宿主退出到安装器起来之间，任何 relaunch / 换包 / 杀进程都会让 NSIS 判「程序正在运行」 | 新增 `inOfficialInstallWindow()`：命中期间**不排换包、不拉起宿主、不杀进程** |
| 状态口径 | 只有 applied / sealed / blocked_at | 新增 `update_phase`：`active`（正常）/ `dormant`（官方安装中）/ `needs-reapply`（宿主已升级，等点应用重打补丁） |
| 开机自愈时机 | 启动后 4 秒开始 reapply（写 70 个文件） | 延后到 120 秒，并在触发时再查一次相位；这期间「一打开就点更新」也不会撞超时 |
| 远程检查 | 默认开启 | 默认关闭，只有面板手动触发才请求远端 |

## 实测过的完整流程（VM，0.2.1-rc.2 → 0.2.1-rc.3）

```
① rc.2 上点「应用」→ 打补丁 + 换包，applied.json 记 host_version=0.2.1-rc.2
② 打开后立刻点「更新」→ 宿主能及时回话 → 进入安装流程 → 官方装 rc.3 → 自动拉起
③ rc.3 上点「应用」→ 解包 + 68 条补丁 + 换包，host_version=0.2.1-rc.3
   （安装器清空的 resources\runtime 由 preflight 与 Startup 守卫补回）
```

## 已知限制

- 官方更新器在极慢的机器上仍可能报 `task inspection timed out`；此时用「退出 dsh → 直接跑 pending 安装包 → 补 runtime → 拉起」这条确定性路径
- 换包观察者依赖 schtasks / WMI 起进程，会话 0 或权限受限环境可能不落地，失败会写 `asar-swap.log`
- 自动更新检查默认关闭，需要在面板手动触发

## 安装

```
npm pack 得到 dsh-purge-1.3.tgz → 解到 profiles\desktop\node_modules\dsh-purge
并把 dsh.profile.bundles 的首位设为 dsh-purge
```