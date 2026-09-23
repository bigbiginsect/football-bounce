# 迁移后开发环境待核实项

更新日期：2026-09-23。

当前工作目录为 `D:\tantanle`。以下只记录当前会话实际发现的缺口；“既有路径未找到”不代表全机未安装。Creator 3.8.8 的实际可执行文件路径和产品版本已于 2026-09-23 重新核实，见 `AGENTS.md`；该环境项关闭。

| 项目 | 当前证据 | 关闭条件 |
| --- | --- | --- |
| Node.js / npm | 旧用户目录当前不存在，`npm.cmd` 不在 PATH；本批使用 Codex 随附 Node 24.19.0 / pnpm，仅用于安装 TypeScript 5.9.3 和自动化检查 | 项目日常终端可直接运行约定的 `npm.cmd ci`、`npm.cmd run check`，记录实际 Node/npm 版本与路径 |
| Android 工具链 | 仍按既定决定延期 | 在其他打包机器开展首次 Android 支线时记录 JDK、SDK/NDK、Gradle、adb、设备和实际构建结果 |

所有环境项补齐并实测归档后删除本文件，同时更新 `AGENTS.md` 的环境表。
