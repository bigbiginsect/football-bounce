# 环境待补齐清单

探查日期：2026-09-20。已检查项目目录、PATH、相关环境变量、常用安装目录、卸载注册表及 `D:\cocos`。未做全盘扫描，也未启动编辑器执行构建；以下“未发现”不代表软件绝对未安装。

## 已具备

- Windows / PowerShell / Git 可用。
- Creator 可执行文件位于 `D:\cocos\editor\Creator\3.8.8\CocosCreator.exe`，产品版本为 `3.8.8`；Dashboard 存在。
- 仓库尚未初始化 Creator 工程，没有游戏资源、源码、依赖清单或测试脚本。

## 待完成与验证

| 状态 | 项目 | 补齐方式与完成证据 |
| --- | --- | --- |
| 待完成 | 2D 工程初始化 | 后续工程初始化任务中用 Creator 3.8.8 在仓库根目录创建 2D 工程；完成资源导入、启动场景预览，记录结果 |
| 未发现可用命令 | Node.js / npm | 为独立 TypeScript 检查与核心测试提供工具链；选定兼容版本后记录 `node --version`、`npm --version` 并锁定依赖。编辑器内置运行时不等于终端已有 Node，也不是编辑器预览的前置缺口 |
| 未发现可用命令 | JDK | 配置 JDK 17、`JAVA_HOME` 和 PATH；新终端中验证 `java -version`、`javac -version`，确认 Gradle 实际使用的 JDK |
| 未核实 | Android 构建工具 | 安装或定位 Android Studio（选择支持 AGP 8.10 的版本）及 SDK Platform 36、Build-Tools 36.0.0、Platform-Tools、NDK、CMake；核实实际版本和路径，在 Creator 原生开发环境中配置 SDK/NDK |
| 未验证 | 下载与构建 | 确认 SDK、Gradle、Google Maven / Maven Central 依赖可获取；使用生成工程自带的 Gradle Wrapper，完成首个 Android debug APK 构建，无需先安装全局 Gradle |
| 未核实 | 真机测试条件 | 准备可安装 APK 的 Android 手机；调试时开启 USB 调试并授权，验证 `adb devices` 与安装启动。最终需两台手机及互通的局域网，记录设备与系统 |

当前环境中未见 `JAVA_HOME`、`ANDROID_SDK_ROOT`、`NDK_ROOT` 等相关变量；默认 `%LOCALAPPDATA%\Android` 目录未发现。自定义路径如已安装，优先定位和复用，无需重复安装。环境变量为空本身不能证明 SDK 不存在。

## 构建版本依据

本机模板目录：`D:\cocos\editor\Creator\3.8.8\resources\resources\3d\engine\templates\android\`。

- `build/build.gradle`：Android Gradle Plugin **8.10.1**。
- `build/gradle/wrapper/gradle-wrapper.properties`：Gradle **8.11.1**。
- `build/gradle.properties`：compile/target SDK **36**、Build-Tools **36.0.0**、min SDK **21**、默认 ABI **arm64-v8a**；NDK 版本留空。这些是安装模板默认值，并非项目已经完成的配置或已验证兼容范围。
- [Android AGP 8.10 官方兼容表](https://developer.android.com/build/releases/agp-8-10-0-release-notes)确认 Gradle 8.11.1、JDK 17 及最高 API 36 的兼容要求。
- [Cocos 3.8 原生环境说明](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/setup-native-development.html)提供 SDK/NDK 配置流程，但其 Android Studio / NDK 推荐覆盖整个 3.8 系列，不能直接替代本机 3.8.8 模板验证。

NDK、CMake 的确切版本在首次构建时结合 3.8.8 实际生成工程和引擎要求确定，成功后固定。不要仅按 AGP 的默认 NDK 推断 Cocos 已兼容，也不要自动升级或降级整套构建工具。工程生成后重新核对上述版本。

## 关闭规则

每补齐一项，将实际路径、版本、验证命令/操作及结果写入对应需求的施工文档，并更新 `AGENTS.md` 的环境部分。所有项目完成验证后删除本文件；不因“已安装”就标记“构建/真机验证通过”。环境文件只承载工具与设备缺口，玩法与服务器方案待定项保留在需求日志中。
