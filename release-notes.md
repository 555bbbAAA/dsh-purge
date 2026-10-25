# 1.3.1

优化插件运行流畅度。

## 与上一版本 v1.3 的对比

| 维度 | v1.3 | v1.3.1 |
|---|---|---|
| 状态查询开销 | 每次请求都重算 76 条补丁的目标文件 | gatherState 缓存 15 秒、targetFiles 缓存 10 秒，应用开始时自动失效 |
| 首屏 | 打开面板要等一次完整计算（约 2 秒） | 先取 lite（仅顶部数字与状态），再拉全量补丁表 |
| 前端轮询 | 1s / 1.5s / 0.4s / 1.2s 多档 | 3s / 5s / 1.2s / 3s，内容未变不重绘 |
| 启动预热 | 无 | 启动后 1.2s 与 5s 各预热一次缓存 |

功能、界面与补丁表均未变化。

## 安装

```
npm pack 得到 dsh-purge-1.3.1.tgz → 解到 profiles\desktop\node_modules\dsh-purge
并把 dsh.profile.bundles 的首位设为 dsh-purge
```
