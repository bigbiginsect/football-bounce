# 球员资产录入流程

本流程用于内部试玩原型。现实球星肖像的公开发行用途须另行确认。首批目录见 `assets/resources/config/players.json`；头像放在 `assets/resources/portraits/`，文件名等于稳定球员 ID。

## 统一 imagegen 提示词

以下模板是后续新增球员的统一提示词。每位球员单独调用 imagegen，只替换 `{NAME}`、`{PEAK_ERA}` 和 `{DISTINCTIVE_FEATURES}`；不要为单个球员另起一套风格描述，也不要用球队标识、号码或照片复制来代替人物特征。首批梅西头像确立风格，后续优先尝试把它仅作为风格参考，并明确不得迁移人物身份。2026-09-23 实际生成后四人时，带公众人物图片参考的请求被 imagegen 安全系统拒绝，因此改用下方同一文字模板分别生成，并人工检查线条、配色和构图；后续遇到相同拒绝时沿用此方式，不反复提交身份迁移请求。

```text
Use case: stylized-concept
Asset type: 1:1 square portrait for a small circular football player token in a mobile 2D game
Subject: {NAME} during {PEAK_ERA}; preserve recognizable facial structure,
hairstyle and facial hair using {DISTINCTIVE_FEATURES}; original interpretation
of their real appearance
Style: polished original 2D cartoon illustration, clean medium-weight dark
outlines, soft cel shading, natural skin tones, gently warm muted colors,
lively but respectful expression; consistent series style
Composition: head and upper shoulders, face centered and readable at 40 pixels;
full head and key features inside the central 80% circular safe area;
eye-level front-facing slight three-quarter turn
Backdrop: simple soft warm ivory background with subtle pale sage vignette,
no scene details
Constraints: no text, numbers, watermark, club or national-team crest,
sponsor, branded kit, copied photograph, or pre-drawn circular border.
Plain unbranded dark teal football shirt.
```

身份特征填充参考：梅西——深棕短发和整齐短胡须；C 罗——棱角分明的面部、深色短发；姆巴佩——极短黑发、年轻面部；德布劳内——浅金短发、浅色眉毛；范戴克——后束深色头发、修整胡须；哈兰德——金色后梳长发、年轻而强壮的面部。人物、构图和小尺寸辨识度须逐张人工核对。把选中的图片复制进工程，不覆盖既有图片；换版使用新文件名并更新目录。Creator 导入后保留 `.meta`。

第二批哈兰德头像保存在 `portraits/haaland.png`，现版效果已用于内部试玩。本次实际提交给 imagegen 的文字与上述统一模板不完全一致，原文只在 [第二批施工记录](../worklogs/2026-09-23-stage3-player-assets/b2.md) 中留作生成溯源，**不作为后续球员的提示词范本**。后续新增球员仍按本节模板、资源导入和目录验证流程执行。

## 目录与属性

`players.json` 有 `version` 和 `players`。每人包含稳定的 `id`、显示名称 `name`、`portraitPath`（固定为 `portraits/<id>`）、`weight`、`power`、`precision`。三项评分均为 0–100 的整数，代表游戏平衡值，不是官方评分。可选 `skill: { id, params }` 只供以后扩展，当前无效果。新增球员只需增加目录项及对应 PNG，更新目录版本并验证加载；改人物 ID 视为新模板，不悄悄重用旧 ID。

首批评分按代表性巅峰技术特点作主观归一：梅西 `55/84/96`、C 罗 `78/96/82`、姆巴佩 `62/90/82`、德布劳内 `70/84/94`、范戴克 `95/77/78`（顺序为重量/力度/精度）。添加新人时与已有五人横向比较，保持相近实力的合理次序，不按当前年龄自动衰减。

第二批候补哈兰德暂定 `90/94/72`，作为强壮前锋的可调整游戏设计值；目录版本为 `players-002`。

游戏参数映射集中在 `PlayerCatalog.ts`。评分 50 等于 stage2-006 基准：

```text
mass       = playerMass * (0.9 + weight / 500)
maxImpulse = maxImpulse * (0.9 + power / 500)
aimLength  = aimLength * (0.8 + precision / 250)
```

调平衡时先试玩碰撞、最大力度和瞄准线，再修改映射或评分并更新配置及目录版本。球员模板和场上实例分开；同队不可重复选模板，两队可以选同一模板。

## 阵容输入与验收

标准比赛创建入口接受 `MatchLineups`：`blue`、`red` 各五项 `{ templateId, position: { x, y } }`。坐标单位米，以球场中心为原点；蓝队在下半场、红队在上半场。创建时检查人数、模板、队内重复、场内与己方半场、球员和皮球不重叠。未传阵容则沿用原有对称开局坐标并让双方使用首批五人；这些默认坐标不是固定阵型规则。当前选人界面通过拖动替换与交换固定五槽，双方确认后提交此接口；新增阵型仍可在将来改变槽位坐标。

每次增加头像：检查原图、圆形遮罩的小尺寸效果、队色外圈、运行时加载与重开；每次调整属性：执行类型检查、目录与阵容测试、比赛回归，并在 Creator 预览中试玩重量与发射差异。Android 真机表现留给既定打包支线。
