# BANMENG Codex Pet

一个面向 Windows Codex 用户的白发二次元桌宠。它会显示真实剩余额度、重置时间与当前任务阶段，并根据 Codex Hooks 切换待命、工作、等待确认和完成动作。

![BANMENG Codex Pet preview](plugins/banmeng-codex-pet/tests/browser-snapshot.png)

## 一键安装

前置条件：Windows 10/11、Node.js 20 或更高版本，以及已经登录的 Codex Desktop 或 Codex CLI。

```powershell
codex plugin marketplace add 977299228k-tech/banmeng-codex-pet
codex plugin add banmeng-codex-pet@banmeng-pets
```

安装后新建一个 Codex 任务并信任插件 Hooks。桌宠会在第一个事件到来时自动启动；首次运行会在后台下载 Electron，通常需要一到三分钟。

更新插件：

```powershell
codex plugin marketplace upgrade banmeng-pets
codex plugin add banmeng-codex-pet@banmeng-pets
```

## 自动发现机制

- Hooks 使用 Codex 注入的 `PLUGIN_ROOT`，不依赖安装用户名或磁盘位置。
- 优先读取可选的 `CODEX_BIN`，随后查找 npm 全局 Codex 和系统中的 `codex.exe`。
- 通过本机 `codex app-server --stdio` 读取 `account/rateLimits/read` 与 `account/usage/read`。
- 使用当前用户已有的 Codex 登录；不会读取、复制或保存账户令牌。
- 运行时仅监听 `127.0.0.1:47831`，用于桌宠 Hooks 和本地状态刷新。

## 本地开发

```powershell
git clone https://github.com/977299228k-tech/banmeng-codex-pet.git
cd banmeng-codex-pet\plugins\banmeng-codex-pet
npm.cmd install
npm.cmd test
npm.cmd start
```

遇到非标准 Codex 安装目录时，可在启动前设置：

```powershell
$env:CODEX_BIN = "D:\Tools\codex.exe"
```

## 许可

代码使用 [MIT License](LICENSE)。角色图片允许随本项目用于运行和二次开发；重新分发衍生角色素材时请保留 BANMENG 项目来源说明。
