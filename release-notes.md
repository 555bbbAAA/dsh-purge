# 1.3

以 1.2.12（实测能完整走通官方升级的那一条线）为基线重建，并补两处时序保护。

## 与上一版本 v1.2.16 的对比

| 维度 | v1.2.16 | v1.3（本版） |
|---|---|---|
| 官方更新路径 | 交还官方（#45 已退役），在慢机器上易踩 10 秒死线 | 保留 #45 接管：归位 asar 后交还官方，慢机器也能装成 |
| 安装空窗期 | 无保护，期间可能 relaunch / 换包，撞 NSIS「程序正在运行」 | 新增 `inOfficialInstallWindow()`：命中时**不排换包、不拉起、不杀进程** |
| 状态口径 | 无 | `/status` 暴露 `update_phase`：active / dormant / needs-reapply |
| 启动自愈 | settle 只看标记 | dormant / needs-reapply 时直接跳过，避免与安装窗口抢 |

## 实测过的完整流程

```
① rc.2 上点「应用」→ 打补丁 + 换包，applied.json 记 host_version=0.2.1-rc.2
② 点「更新」→ 点「重启」→ 插件归位 asar 交还官方 → 官方装 rc.3 → 自动拉起
③ rc.3 上点「应用」→ 解包 + 68 条补丁 + 换包，host_version=0.2.1-rc.3
   （安装器清空的 resources\runtime 由 preflight + Startup 守卫补回）
```

## 已知限制

- 官方更新器在某些机器上仍可能报 `task inspection timed out`，此时用「退出 dsh → 直接跑 pending 安装包 → 补 runtime → 拉起」这条确定性路径
- 换包观察者依赖 schtasks / WMI 起进程，会话 0 或权限受限环境可能不落地，失败会写 asar-swap.log
- 自动更新检查默认关闭，需要在面板手动触发

## 安装

```
npm pack 得到 dsh-purge-1.3.tgz → 解到 profiles\desktop\node_modules\dsh-purge
并把 dsh.profile.bundles 的首位设为 dsh-purge
```