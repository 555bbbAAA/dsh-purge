# 1.3.2

适配 DeepSeek Harness 0.2.1-rc.5，并修掉应用内更新报 `desktop update: task inspection timed out` 的根因。

## 与上一版本 v1.3.1 的对比

| 维度 | v1.3.1 | v1.3.2 |
|---|---|---|
| 宿主兼容 | 声明 0.2.1-rc.3 | 声明 `>=0.2.1-rc.3 <0.3.0`，rc.3 / rc.4 / rc.5 实测锚点全命中 |
| 官方更新窗口判据 | 只认自己的 restarting 标记与 restart.log | 增加「官方 pending 安装包版本 ≠ 当前宿主版本」，官方更新器不写我们的标记也能识别 |
| settle 与更新器抢事件循环 | updateBusy 只查标记 + tasklist | 先查 pending（只读目录与 JSON，不 spawn），再查 tasklist；点更新时 settle 立即让路 |
| 判据健壮性 | 无 | update-info.json 剥 BOM；JSON 坏时回退扫 pending 目录里的 *.exe 文件名 |

## 0.2.1-rc.5 兼容性核查结论

- 补丁目标文件 49 个，上游 rc.5 改到 0 个。
- 两棵干净树（rc.3 与 rc.5 各 42 个包）逐补丁比对，锚点与文件数 delta 全为 0。
- rc.5 的五处实质改动（`reasoningText()` 剥离 `<signature>`、reasoning Body Slot 的 ownerProps 由 `text` 改为 `rawText`/`displayText`、会话视图页签按 88px 估算决定是否挂 tooltip、mcp `resources/list` 先查 serverCapabilities、commit 号变更）没有任何一条补丁触碰。
- 桌面外壳五条（#45 #46 #82 #83 #84）按顺序施加到 rc.5 的 `lib/main.js`，产出 520,975 字节，与 rc.3 上打完的结果完全一致。

## 已知限制

- VM 上尚未实测「远程更新 1.3.1 → 1.3.2」；发布前只在主机侧做了静态与单测验证。
- `desktop update: task inspection timed out` 的另一半成因（host 事件循环被同步 IO 按住）无法在插件侧完全消除；本次只保证「官方安装窗口内插件不写盘」，settle 之外的重活仍需等用户点应用。
- 三个 rc.3 起不兼容的第三方插件（`@wingsky-1/dsh-mcp-manager` 0.2.8、`@anionex/dsh-vision-toolkit` 0.1.46、`dsh-workbuddy-connect` 0.7.x）与本插件无关，不要给 allow-version。

## 安装

```
dsh plugin --profile desktop add file:<path>/dsh-purge-1.3.2.tgz
```

装完确认 `dsh.profile.bundles` 首位是 `dsh-purge`，再重启宿主。
