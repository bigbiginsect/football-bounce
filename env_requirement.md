# 迁移后开发环境待核实项

更新日期：2026-09-23。

项目已迁移至 `D:\GameProjects\football-bounce-git`。以下只记录当前会话实际发现的缺口；“既有路径未找到”不代表全机未安装。

| 项目 | 当前证据 | 关闭条件 |
| --- | --- | --- |
| Cocos Creator 3.8.8 | 用户已实际运行 stage2-001 并反馈“可以玩”，`temp/tsconfig.cocos.json` 已生成，完整类型检查通过；旧路径当前不存在，实际可执行文件路径尚未记录 | 核实并记录当前 Creator 3.8.8 的实际安装路径和产品版本 |
| Node.js / npm | 旧用户目录当前不存在，`npm.cmd` 不在 PATH；本批使用 Codex 随附 Node 24.19.0 / pnpm，仅用于安装 TypeScript 5.9.3 和自动化检查 | 项目日常终端可直接运行约定的 `npm.cmd ci`、`npm.cmd run check`，记录实际 Node/npm 版本与路径 |
| Android 工具链 | 仍按既定决定延期 | 在其他打包机器开展首次 Android 支线时记录 JDK、SDK/NDK、Gradle、adb、设备和实际构建结果 |

所有环境项补齐并实测归档后删除本文件，同时更新 `AGENTS.md` 的环境表。
