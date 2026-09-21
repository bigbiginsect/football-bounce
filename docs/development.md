# 开发与验证

引擎固定为 Cocos Creator 3.8.8。通过 Dashboard 导入本仓库根目录，不能再创建同名子目录。启动场景为 `assets/scenes/Boot.scene`，双击打开后，在顶部预览平台选择 **Preview In Editor（编辑器内）**，点击运行。当前应显示阶段 1 竖屏球场与操作提示，检查控制台无新增脚本错误；停止后再次运行验证。普通场景编辑视图不能代替实际运行。详见 [阶段 1 试玩与调参](stage1-playtest.md)，阶段 1 已由用户试玩后确认关闭，见 [验收结论](../worklogs/2026-09-20-stage1-launch-physics/requirement-gap.md)。外部浏览器为可选调试方式。

编辑器内运行预览、浏览器预览均不能替代最终 Android 真机验收。依据：[Creator 3.8 官方预览调试说明](https://docs.cocos.com/creator/3.8/manual/zh/editor/preview/)。

## 首次打开与检查

1. 用 3.8.8 打开根目录，等待资源导入和脚本编译完成。编辑器生成 `temp/tsconfig.cocos.json` 及引擎声明，不要手工补造这些文件。
2. 安装 Node.js 22；本机已验证 22.23.2 / npm 10.9.8。在根目录执行 `npm.cmd ci --ignore-scripts --no-audit --no-fund`。
3. `npm.cmd run typecheck`：检查全部游戏 TypeScript，继承 Creator 生成配置。工程启用 strict，仅跳过第三方声明内部检查。
4. `npm.cmd test`：编译纯核心/应用模块到忽略的 `.test-output/`，再运行 Node 内置测试；不需要启动 Creator，也不需要引擎声明。
5. `npm.cmd run check`：顺序运行完整类型检查与核心测试。仅检查纯模块可用 `npm.cmd run typecheck:core`。
6. 日常运行 `git status --short`、`git diff --check`。提交 `package-lock.json`、共享设置以及资源对应的 `.meta`。

PowerShell 使用 `npm.cmd` 无需修改执行策略。若旧终端找不到 Node/npm，重启终端及其宿主应用，使用户 PATH 生效。完整类型检查报告缺少 `temp/tsconfig.cocos.json` 时，先打开工程等待导入；独立核心测试仍可单独执行。

## 当前边界

- `core/`：纯 JSON 类型及命令校验，无 `cc`、网络、系统时钟依赖。
- `application/LocalMatch.ts`：唯一状态写入入口。初始化只接受可信应用创建的状态；执行时另传会话身份，不能拿载荷自报身份代替。快照和命令记录返回深拷贝。
- 发射方向采用单位向量，数值误差允许 `1e-6`，力度为 `(0, 1]`；输入层在球场坐标中反向映射拖动，死区取消，不提交零力度命令。
- 当前回合已接受命令 ID 再次提交拒绝；完成回合后清理 ID 集合，旧回合仍由回合号拒绝。回合号必须完全相等，过期与未来命令均拒绝，不排队。原型使用 `Aiming → Simulating → Resolving → Aiming`，同一测试操作者继续练习，不代表正式换手规则。
- 最近 100 条命令及 100 个关键快照返回深拷贝；物理异常可以恢复发射前快照。未实现外部恢复协议、持久化、比分结算或跨端同步，不承诺跨设备确定性。
- `adapters/physics/CocosPhysics.ts` 实现固定步 Box2D 适配；`Boot.ts` 组合会话、触摸和视图。`PrototypeView.ts` 只绘制状态，`PrototypeConfig.ts` 集中定义并校验参数。规则核心没有 `cc` 依赖。

运行时采用 720×1280 设计分辨率、SHOW_ALL 等比适配；场内 6.8×10.5 米，位置与速度使用米和米/秒。状态坐标不受 UI 缩放影响。参数与未定玩法见对应阶段需求文档。

## 资源与交付

资源及目录的 `.meta` 由 Creator 生成，移动资源时同步移动，避免 UUID 丢失。`library/`、`temp/`、`profiles/`、依赖、日志和包产物不入库；`native/`、`build-templates/` 不整体忽略，后续定制文件按需维护。不要提交签名密钥。

Android 工具链、首次试包与真机验收按 [路线图](../ROADMAP.md) 支线执行，本机不安装。浏览器预览和核心测试不能关闭 Android 交付或双机局域网验收。
