# dsh-purge

DeepSeek Harness 桌面版的本地兼容层。基于上游 [1.1.71](https://github.com/YuJunZhiXue/dsh-purge) 维护，支持 0.2.1 整条版本线。

当前版本 **1.3.8** · `dshTarget: >=0.2.1-0 <0.3.0` · MIT

## 兼容性

| 宿主版本 | 状态 |
|---|---|
| 0.2.1-rc.1 ~ rc.5 | 完整支持。73 条补丁，54 条展示项全绿、11 条 na |
| 0.2.1 正式版 | 同上，与 rc.5 同源 |
| 0.2.2-rc.1 | 完整支持。73 条补丁，55 条展示项全绿、10 条 na（比 0.2.1 多出 #47/#49/#57/#89 四条，少了 hooks 四条） |
| 0.3.0 及以上 | 不支持 |

na 项均为 `optional: true` 且目标文件在上游不存在，属正常。0.2.2 起上游移除了 `dsh-hooks-claude-code` / `dsh-hooks-codex` 两个包，补丁 #30/#31/#64/#65 已退役（定义留源码，不参与应用与计数）。

## 功能

- 运行时自愈（preflight 插件 + 120 秒 settle + Startup 守卫三层）
- 更新三态：`active` / `dormant`（官方安装窗口内不写盘、不换包、不杀进程）/ `needs-reapply`
- 补丁换包与状态可查
- 清洗上游身份段与拒答面
- 修掉宿主收到 shutdown 后不退出（#89），让应用内更新能装完并重启
- 内置演练台：5 个执行角色、23 个技能文档，入口在右侧栏

## 安装

见 [INSTALL.md](INSTALL.md)。验收记录 [VERIFY.md](VERIFY.md)。版本变更 [release-notes.md](release-notes.md)。

## 已知限制

- Startup 守卫只覆盖登录窗口；非管理员账号建不了计划任务
- 设置页「继续/重试」配置区不显示，参数可改 `cordis.patch.yml`，重启生效
- `GET /dsh-purge/update` 走 30 秒短缓存，连点「检查更新」拿到的是上次结果

## 免责

本地开发工具，运行在用户自己的电脑上，修改本机已安装应用的内部文件，不对外提供服务。
