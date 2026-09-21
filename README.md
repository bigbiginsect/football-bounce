# 足球弹弹乐

基于 Cocos Creator 3.8.8 / TypeScript 的手机 2D 桌球式足球游戏。

阶段 1 发射与物理原型已完成（2026-09-21 用户确认收工，stage1-003），启动场景为 `assets/scenes/Boot.scene`。反向拖动蓝方球员可进行碰撞练习，提供普通／密集／贴墙／角落摆位与重置；完整类型检查及 46 项常规测试通过，另有 12 项真实 Box2D 贴墙测试通过，用户已确认拖动、贴墙和角落修复并接受阶段交付。本地完整对局与局域网联机按路线图继续推进，最终交付为支持同局域网双 Android 手机对战的 APK。

阶段 0 已完成：工程重新打开、Creator 编辑器内运行预览与重复启动、完整类型检查和 18 项核心测试均通过。见 [复验记录](worklogs/2026-09-20-stage0-foundation/b2.md)。

- [开发与验证](docs/development.md)：打开工程、安装依赖、类型检查和独立测试。
- [阶段 1 试玩与调参](docs/stage1-playtest.md)：操作步骤、人工验收清单、参数默认值与修改方法。
- [路线图](ROADMAP.md)：阶段范围与实际验收状态。
- [协作约定](AGENTS.md)：架构、资源、日志和交付规范。
- [阶段 0 需求与差距](worklogs/2026-09-20-stage0-foundation/requirement-gap.md)。

阶段 1 的最终配置、验收依据及后续边界见 [验收结论](worklogs/2026-09-20-stage1-launch-physics/requirement-gap.md)。下一步为阶段 2 本地双人完整对局的需求确认。
