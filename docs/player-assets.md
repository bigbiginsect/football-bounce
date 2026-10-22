# 球员资产录入流程

本流程用于内部试玩原型。现实球星肖像的公开发行用途须另行确认。当前 22 人目录见 `assets/resources/config/players.json`；头像放在 `assets/resources/portraits/`，文件名等于稳定球员 ID。

球员数据、头像、属性、技能及必要测试在长期分支 `codex/player-warehouse` 开发，验证后合并回 `main`；两者都保留完整游戏。main 的其他更新也需定期同步回 warehouse，具体操作见 [长期分支流程](development.md#长期分支与更新流程)。2026-10-22 整理依据及结果见 [施工记录](../worklogs/2026-10-22-branch-consolidation/b1.md)。

## 统一 imagegen 提示词

2026-10-10 起以用户提供的正面圆形徽章为风格参考。每位球员单独生成，只替换 `{NAME}` 和 `{DISTINCTIVE_FEATURES}`，要求暖橙内底、深灰金属外圈、正面头肩肖像、无文字及品牌。图片仅作风格参考，不迁移参考图人物身份。对生成工具拒绝的人物保留既有项目头像，并在施工记录中写明。

```text
Use case: stylized-concept
Asset type: square portrait badge for a mobile tabletop football game.
Reference image: style and composition only, not the person.
Subject: {NAME}; {DISTINCTIVE_FEATURES}.
Style: respectful, semi-realistic polished painted illustration.
Composition: front-facing head and upper shoulders, centered, readable at 40 pixels.
Backdrop: vivid orange circular inner field, thick glossy charcoal metallic
outer rim, white square corners; whole badge inside the canvas.
Clothing: plain dark football shirt without logo.
Constraints: no text, numbers, watermark, football, club crests or other people.
```

人物、构图和小尺寸辨识度须逐张核对。把选中的图片复制进工程；确需换版时按需求决定替换既有资源或使用新文件名并更新目录。Creator 导入后保留 `.meta`。

首批六张旧头像的生成溯源仍见 [第二批施工记录](../worklogs/2026-09-23-stage3-player-assets/b2.md)。当前梅西保留旧版插画，其余头像按本批徽章风格生成；后续新增球员使用本节模板。

## 目录与属性

`players.json` 有 `version` 和 `players`。每人包含稳定的 `id`、显示名称 `name`、能力档 `rarity`、俏皮话 `quip`，以及 `weight`、`power`、`precision`、`mentality`、`curve` 五项评分。`rarity` 为 `red > gold > purple > blue`，是内部游戏设计档位，不是现实世界官方排名。原20人均有 `portraitPath: portraits/<id>`；齐祖（齐达内）与甜菜（克罗斯）暂用姓名徽章，后续补头像时再由 Creator 生成 meta。评分均为 0–100 的整数。每人有 `skill: { id, name, params }`，目录在运行时验证 ID 和参数。改人物 ID 视为新模板，不悄悄重用旧 ID。

首批评分按代表性巅峰技术特点作主观归一：梅西 `55/84/96`、C 罗 `78/96/82`、姆巴佩 `62/90/82`、德布劳内 `70/84/94`、范戴克 `95/77/78`（顺序为重量/力度/精度）。添加新人时与已有五人横向比较，保持相近实力的合理次序，不按当前年龄自动衰减。

`players-007` 共22人，红档6、金档7、紫档5、蓝档4。保留 C 罗的 `aim-wobble` 与内马尔的 `ball-hit-encore`，新增三种可复用技能机制：`power-burst` 每第 N 次本人正常发射提高物理冲量；`aim-boost` 常驻延长辅助瞄准线；`mass-boost` 常驻增加碰撞质量，并同步补偿发射冲量。各人技能名称和倍率由目录配置。强力发射计数与原有连击计数都保存在 GameState；客户端发射 Command 仍只带归一化力度，实际技能倍率由本地权威层传给物理适配器。具体数值为待 Creator 试玩的设计假设。

游戏参数映射集中在 `PlayerCatalog.ts`。评分 50 等于 stage2-006 基准：

```text
massScale  = weightMassFactorPer50 ^ ((weight - 50) / 50) * massBoost
mass       = playerMass * massScale
powerScale = 1 + (power - 50) * powerSpeedScalePerPoint
maxImpulse = maxImpulse * massScale * powerScale
aimLength  = aimLength * (1 + (precision - 50) * precisionAimScalePerPoint) * aimBoost
powerCircleMaxRadius = powerCircleMaxRadius * (1 + (power - 50) * powerCircleScalePerPoint)
```

默认 `weightMassFactorPer50 = 3.2`，使重量评分相差 50 时质量相差 3.2 倍；质量补偿进入发射冲量，所以相同力量评分的轻重球员起步速度近似一致，而重球员保留更大的碰撞动量。默认力量、精度线与力度盘上限每分均改变 0.6%，相邻高分也能产生小幅可见差异；全局速度上限相应微调为 `16.5 m/s`，当前目录每位球员的满力度起步速度都低于上限，不会被限速抹平差异。当前拖动力度决定圆盘从球员半径增长到该球员上限。精度只决定三层虚线瞄准辅助的长度，不预测碰撞或反弹。心理（mentality）决定本次启动的状态概率；弧度可受状态与半场技能改变评分，当前仍未接入弧线发射物理。调平衡时先试玩碰撞、最大力度、力度盘和瞄准线，再修改配置或评分并同步版本。球员模板和场上实例分开；同队不可重复选模板，两队可以选同一模板。

## 阵容输入与验收

标准比赛创建入口接受 `MatchLineups`：`blue`、`red` 各五项 `{ templateId, position: { x, y } }`。坐标单位米，以球场中心为原点；蓝队在下半场、红队在上半场。创建时检查人数、模板、队内重复、场内与己方半场、球员和皮球不重叠。未传阵容时使用首批五人和默认 `2-1-2`；赛前还可选择 `2-2-1`、`1-2-2`，双方分别保存阵型，红方坐标按球场中心旋转。赛前统一页面将阵型、五名首发和候补仓库放在同一纵向滚动内容中；仓库仅显示当前队未上场球员，以四列竖卡展示头像、姓名与能力档配色；属性与技能留在详情中。普通滑动浏览，长按 0.2 秒抓起后拖入槽位替换，旧球员回仓；首发拖动交换。靠近视口上下边缘可自动滚动，轻点球员查看信息；不提供按钮换人或预选槽位。名单和阵型都经 `LineupEditor` 校验后提交同一比赛入口；本批不支持自由摆位。

每次增加头像：检查原图、圆形遮罩的小尺寸效果、队色外圈、运行时加载与重开；仅增加姓名占位球员时检查四个界面的姓名可读性。每次调整属性：执行类型检查、目录与阵容测试、比赛回归，并在 Creator 预览中试玩重量与发射差异。Android 真机表现留给既定打包支线。

## 心理状态与半场技能

2026-10-22 在 warehouse 开发心理状态与两位中场球员，详细参数、假设和验证见 [本批记录](../worklogs/2026-10-22-player-condition-auras/b1.md)。启动时按种子为每个模板抽取一次状态，重开、切队、换人和进球复位不重抽，同模板双队共用结果。红↑使力量/精准/弧度+20%，无箭头不变，绿↓为-20%，重量与心理不变。

概率暂定为中性30%，红箭头概率10%＋心理×0.5%，绿色为剩余概率；配置在 PlayerCatalog.ts 的 mentalityConditionConfig。生效属性从基础评分派生：状态与光环的百分点相加后一次四舍五入，最低0、不封顶100；例如89红状态为107（+18）。卡片显示生效数值，括号增量为绿色、减量为红色；属性条固定五颗小型近圆十二边形水晶，已达部分采用饱和绿/青/紫/金/红，以4.5设计单位粗线渐变连接；节点在20/40/60/80/100分点亮，75分到达前三颗并向第四颗走75%，未达水晶和连线均为灰色，100后保持第五颗满格、不再延长。

齐祖的 half-all-aura 与甜菜的 half-playmaker-aura 幅度暂定为 players.json 中 percent=0.1。按技能本人位置判断半场：己方半场含中线时强化本队场上全员，在对方半场时削弱对手场上全员，齐祖作用于力量/精准/弧度，甜菜仅力量/精准。持有者在己方半场也获得自身强化；不同来源百分点可叠加或抵消，未上场者不产生效果。赛前首发详情预览当前队开局光环，候补详情仅显示本次状态；比赛按权威实际位置重算，发射和瞄准使用同一生效评分。

GameState升级v6，保存启动状态种子、抽签结果和场上实例基础评分，JSON恢复保留原状态；不支持把旧v5快照当作v6使用。Command保持原协议，客户端不能自报加成。增益后的发射仍受原maxSpeed上限限制，+20%属性不等于实际速度必增20%。
