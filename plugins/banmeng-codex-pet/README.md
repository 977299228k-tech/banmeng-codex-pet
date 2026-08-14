# BANMENG Codex Pet

Windows 白发 Codex 桌宠，显示真实额度和任务活动。

## 功能

- 透明、无边框、始终置顶的桌宠窗口。
- 使用现有 Codex 登录读取真实剩余额度、重置时间和累计 token。
- 通过 Codex Hooks 显示理解任务、工具执行、等待确认、完成等状态。
- 空闲时会在当前显示器内自主漫步，靠近屏幕边缘时自动转身。
- 支持拖动角色、悬停停步、视线跟随、单击回应和双击跳跃互动。
- 任务执行时自动停步并切换工作动作；右键可刷新额度、归位或退出。
- 遵循系统减少动画设置。

## Marketplace 安装

```powershell
codex plugin marketplace add 977299228k-tech/banmeng-codex-pet
codex plugin add banmeng-codex-pet@banmeng-pets
```

Hooks 会通过 `PLUGIN_ROOT` 自动找到当前插件目录。首次启动缺少 Electron 时，启动脚本会在后台运行 `npm install`。

## 本地运行

```powershell
npm.cmd install
npm.cmd start
```

运行时只在 `127.0.0.1:47831` 监听本地事件，不读取或保存账户令牌。

调试接口：`GET /health` 查看进程健康，`GET /state` 查看当前任务、额度和账户状态。
