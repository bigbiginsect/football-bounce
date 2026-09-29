import { Canvas, Camera, Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Vec3, isValid, tween } from 'cc';
import type { Vector2Data } from '../core/GameState';
import type { FormationId } from '../core/Lineup';
import type { PlayerCatalog, PlayerTemplate } from '../core/PlayerCatalog';
import { getPlayerTemplate, playerSkillPresentation } from '../core/PlayerCatalog';
import type { WarehouseCommand, WarehouseSnapshot } from '../application/PlayerWarehouse';

type CardAction = 'info' | 'deploy';
type StatIcon = 'weight' | 'power' | 'precision' | 'mentality' | 'curve';
type Touch = {
    id: number;
    start: Vector2Data;
    last: Vector2Data;
    mode: 'navigate' | 'back' | 'formation' | 'slot' | 'action' | 'scroll' | 'drawer' | 'modal';
    slot?: number;
    formationId?: FormationId;
    templateId?: string;
    action?: CardAction | 'close';
    drawerStartProgress?: number;
};

export interface WarehouseNavigation {
    readonly previewBack: (progress: number) => void;
    readonly finishBack: (complete: boolean) => void;
}

const drawerHeight = 1180;
const collapsedDrawerTop = 170;
const focusedDrawerTop = -300;
const expandedDrawerTop = 548;
const viewportY = 0;
const viewportHeight = 920;
const listStartY = 350;
const rowStep = 220;
const infoCloseCenter = { x: 296, y: 535 } as const;
const infoFooterCenter = { x: 0, y: -500 } as const;

/** 层叠式阵型/仓库表现层；所有阵型和上阵修改经 PlayerWarehouse/LineupEditor 执行。 */
export class PlayerWarehouseView {
    readonly root: Node;
    private readonly camera: Camera;
    private readonly navigationTransform: UITransform;
    private readonly formationLayer: Node;
    private readonly compactFormation: Node;
    private readonly focusedFormation: Node;
    private readonly drawer: Node;
    private readonly viewport: Node;
    private readonly content: Node;
    private readonly sideLabel: Label;
    private readonly drawerHint: Label;
    private readonly formationButtons: { id: FormationId; node: Node }[] = [];
    private readonly activeCards: { slot: number; node: Node }[] = [];
    private readonly playerCards: { id: string; node: Node }[] = [];
    private snapshot!: WarehouseSnapshot;
    private scrollOffset = 0;
    private drawerProgress = 0;
    private drawerAnimating = false;
    private formationFocused = false;
    private touch?: Touch;
    private infoPanel?: Node;

    constructor(parent: Node, private readonly catalog: PlayerCatalog,
        private readonly portraits: ReadonlyMap<string, SpriteFrame>,
        private readonly submit: (command: WarehouseCommand) => void,
        private readonly navigation: WarehouseNavigation) {
        const camera = parent.getComponent(Canvas)?.cameraComponent;
        const transform = parent.getComponent(UITransform);
        if (!camera || !transform) throw new Error('球员仓库需要 Canvas 相机和 UITransform');
        this.camera = camera; this.navigationTransform = transform;
        this.root = this.node(parent, 'PlayerWarehouse', 720, 1280);
        this.panel(this.root, 'Background', 720, 1280, 0, 0, new Color(8, 31, 39), 0);
        this.panel(this.root, 'TopGlow', 720, 170, 0, 555, new Color(24, 91, 91), 0);
        this.button(this.root, '← 返回', -286, 592, 116, 54, new Color(39, 104, 108));
        this.label(this.root, '阵型与球员仓库', 35, 601, 32, 410);
        this.sideLabel = this.label(this.root, '', 35, 560, 18, 520, new Color(184, 224, 216));

        this.formationLayer = this.node(this.root, 'FormationLayer', 720, 1280);
        this.compactFormation = this.node(this.formationLayer, 'CompactFormation', 720, 1280);
        this.focusedFormation = this.node(this.formationLayer, 'FocusedFormation', 720, 1280);
        this.drawFormationPitch(this.compactFormation, false);
        this.drawFormationPitch(this.focusedFormation, true);
        this.focusedFormation.active = false;
        this.label(this.formationLayer, '选择阵型', -267, 505, 20, 120, new Color(213, 239, 224));

        this.drawer = this.panel(this.root, 'WarehouseDrawer', 692, drawerHeight, 0,
            collapsedDrawerTop - drawerHeight / 2, new Color(226, 239, 229), 28);
        const drawerBorder = this.drawer.getComponent(Graphics)!;
        drawerBorder.strokeColor = new Color(56, 128, 112); drawerBorder.lineWidth = 4; drawerBorder.stroke();
        this.panel(this.drawer, 'DrawerHandle', 116, 12, 0, 568, new Color(78, 127, 119), 6);
        this.label(this.drawer, '球员仓库', -206, 526, 28, 240, new Color(28, 70, 68));
        this.drawerHint = this.label(this.drawer, '上拉展开全屏', 204, 526, 17, 220, new Color(78, 116, 106));
        this.label(this.drawer, '点击上场球员可选择替换槽位', 0, 486, 16, 600, new Color(99, 128, 118));

        this.viewport = this.node(this.drawer, 'WarehouseViewport', 660, viewportHeight);
        this.viewport.setPosition(0, viewportY);
        const mask = this.viewport.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_RECT;
        this.content = this.node(this.viewport, 'WarehouseContent', 660, viewportHeight);
        this.setDrawerProgress(0);
    }

    setSnapshot(snapshot: WarehouseSnapshot): void {
        this.snapshot = snapshot;
        const formation = snapshot.formations.find(item => item.id === snapshot.formationId)!;
        this.sideLabel.string = `${snapshot.side === 'blue' ? '蓝队' : '红队'}　·　${formation.label}`
            + `　·　已选择第 ${snapshot.selectedSlot + 1} 槽`;
        this.sideLabel.color = snapshot.side === 'blue' ? new Color(112, 201, 255) : new Color(255, 139, 139);
        for (const item of this.formationButtons) item.node.destroy();
        for (const item of this.activeCards) item.node.destroy();
        for (const item of this.playerCards) item.node.destroy();
        this.formationButtons.length = 0; this.activeCards.length = 0; this.playerCards.length = 0;
        const formationSpacing = 188;
        snapshot.formations.forEach((item, index) => {
            const selected = item.id === snapshot.formationId;
            const x = (index - (snapshot.formations.length - 1) / 2) * formationSpacing;
            const button = this.button(this.formationLayer, item.label, x, 472, 174, 48,
                selected ? new Color(233, 146, 58) : new Color(35, 99, 82));
            const border = button.getComponent(Graphics)!; border.strokeColor = selected
                ? new Color(255, 221, 148) : new Color(89, 155, 132); border.lineWidth = selected ? 3 : 2; border.stroke();
            this.formationButtons.push({ id: item.id, node: button });
        });
        snapshot.active.forEach((templateId, slot) => {
            const selected = slot === snapshot.selectedSlot;
            const card = this.activeCard(templateId, slot, selected);
            const position = snapshot.slotPositions[slot];
            const display = this.activeCardPosition(position);
            card.setPosition(display.x, display.y);
            this.activeCards.push({ slot, node: card });
        });
        snapshot.players.forEach((templateId, index) => {
            const card = this.playerCard(templateId, snapshot.active.indexOf(templateId) >= 0);
            const column = index % 2; const row = Math.floor(index / 2);
            card.setPosition(column === 0 ? -158 : 158, listStartY - row * rowStep + this.scrollOffset);
            this.playerCards.push({ id: templateId, node: card });
        });
        this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll());
        this.placeCards();
    }

    touchStart(id: number, screenPoint: Vector2Data): boolean {
        if (this.touch) return true;
        const point = this.local(screenPoint);
        if (this.infoPanel) {
            this.touch = { id, start: point, last: point, mode: 'modal',
                action: this.hitInfoClose(point) ? 'close' : undefined };
            return true;
        }
        if (point.x >= -344 && point.x <= -228 && point.y >= 560 && point.y <= 624) {
            this.touch = { id, start: point, last: point, mode: 'back' }; return true;
        }
        if (point.y >= 548 || point.x >= 330) {
            const navPoint = this.navigationPoint(screenPoint);
            this.touch = { id, start: navPoint, last: navPoint, mode: 'navigate' };
            this.navigation.previewBack(0); return true;
        }
        if (this.drawerAnimating) return true;
        if (this.hitDrawerHandle(point)) {
            this.touch = { id, start: point, last: point, mode: 'drawer',
                drawerStartProgress: this.drawerProgress }; return true;
        }
        if (point.y > this.drawerTop()) {
            const formationId = this.hitFormation(point);
            if (formationId) {
                this.touch = { id, start: point, last: point, mode: 'formation', formationId }; return true;
            }
            const slot = this.hitSlot(point);
            if (slot !== null) {
                this.touch = { id, start: point, last: point, mode: 'slot', slot }; return true;
            }
        }
        const hit = this.hitCardAction(point);
        if (hit) {
            this.touch = { id, start: point, last: point, mode: 'action', ...hit }; return true;
        }
        if (this.insideViewport(point)) {
            this.touch = { id, start: point, last: point, mode: 'scroll' }; return true;
        }
        return true;
    }

    touchMove(id: number, screenPoint: Vector2Data): void {
        const touch = this.touch;
        if (!touch || touch.id !== id) return;
        if (touch.mode === 'navigate') {
            const point = this.navigationPoint(screenPoint);
            const progress = Math.max(0, Math.min(1, (touch.start.x - point.x) / 720));
            this.navigation.previewBack(progress); touch.last = point; return;
        }
        const point = this.local(screenPoint);
        if (touch.mode === 'drawer') {
            const startProgress = touch.drawerStartProgress ?? this.drawerProgress;
            this.setDrawerProgress(startProgress
                + (point.y - touch.start.y) / (expandedDrawerTop - this.restingDrawerTop()));
            touch.last = point; return;
        }
        if (touch.mode === 'action' && Math.hypot(point.x - touch.start.x, point.y - touch.start.y) > 14) {
            touch.mode = 'scroll'; touch.action = undefined; touch.templateId = undefined;
        }
        if (touch.mode === 'scroll') {
            this.scrollOffset = Math.max(0, Math.min(this.maxScroll(),
                this.scrollOffset + point.y - touch.last.y));
            this.placeCards();
        }
        touch.last = point;
    }

    touchEnd(id: number, screenPoint: Vector2Data): void {
        const touch = this.touch;
        if (!touch || touch.id !== id) return;
        if (touch.mode === 'navigate') {
            const point = this.navigationPoint(screenPoint);
            const dx = point.x - touch.start.x; const dy = point.y - touch.start.y;
            this.touch = undefined;
            this.navigation.finishBack(dx <= -105 && Math.abs(dx) > Math.abs(dy) * 1.15);
            return;
        }
        const point = this.local(screenPoint);
        if (touch.mode === 'drawer') {
            const dy = point.y - touch.start.y; this.touch = undefined;
            const expand = Math.abs(dy) >= 36 ? dy > 0 : this.drawerProgress >= 0.5;
            this.snapDrawer(expand); return;
        }
        this.touch = undefined;
        if (Math.hypot(point.x - touch.start.x, point.y - touch.start.y) > 24) return;
        if (touch.mode === 'back') { this.navigation.finishBack(true); return; }
        if (touch.mode === 'modal') {
            if (touch.action === 'close') this.closeInfo();
            return;
        }
        if (touch.mode === 'formation' && touch.formationId) {
            this.submit({ type: 'SelectFormation', formationId: touch.formationId });
            this.focusFormation(); return;
        }
        if (touch.mode === 'slot' && touch.slot !== undefined) {
            this.submit({ type: 'SelectSlot', slot: touch.slot }); return;
        }
        if (touch.mode === 'action' && touch.templateId && touch.action === 'info') {
            this.showInfo(touch.templateId); return;
        }
        if (touch.mode === 'action' && touch.templateId && touch.action === 'deploy') {
            this.submit({ type: 'DeployPlayer', templateId: touch.templateId });
        }
    }

    touchCancel(id?: number): void {
        if (id !== undefined && this.touch?.id !== id) return;
        const navigation = this.touch?.mode === 'navigate';
        const drawer = this.touch?.mode === 'drawer' ? this.touch.drawerStartProgress : undefined;
        this.touch = undefined;
        if (navigation) this.navigation.finishBack(false);
        if (drawer !== undefined) this.snapDrawer(drawer >= 0.5);
    }

    private activeCard(templateId: string, slot: number, selected: boolean): Node {
        const template = getPlayerTemplate(this.catalog, templateId);
        const card = this.panel(this.formationLayer, `Active-${templateId}`, 94, 102, 0, 0,
            selected ? new Color(42, 125, 105) : new Color(25, 72, 77), 16);
        const g = card.getComponent(Graphics)!; g.strokeColor = selected
            ? new Color(255, 221, 103) : new Color(104, 166, 163); g.lineWidth = selected ? 5 : 2; g.stroke();
        this.avatar(card, templateId, 52, 0, 20);
        this.label(card, template.name, 0, -19, 14, 90);
        if (selected) this.label(card, `槽 ${slot + 1}`, 0, -40, 11, 84, new Color(255, 231, 132));
        return card;
    }

    private drawFormationPitch(parent: Node, focused: boolean): void {
        const panelHeight = focused ? 846 : 360;
        const panelY = focused ? 110 : 352;
        const formationPanel = this.panel(parent, 'FormationPanel', 676, panelHeight, 0, panelY,
            new Color(15, 61, 55), 24);
        const formationBorder = formationPanel.getComponent(Graphics)!;
        formationBorder.strokeColor = new Color(56, 133, 112); formationBorder.lineWidth = 3;
        formationBorder.roundRect(-338, -panelHeight / 2, 676, panelHeight, 24); formationBorder.stroke();

        const pitchHeight = focused ? 700 : 246;
        const pitchY = focused ? 65 : 330;
        const pitch = this.panel(parent, 'FormationPitch', 632, pitchHeight, 0, pitchY,
            new Color(33, 132, 87), 13);
        const stripes = pitch.getComponent(Graphics)!;
        stripes.fillColor = new Color(38, 145, 93);
        const bandHeight = (pitchHeight - 12) / (focused ? 10 : 5);
        const bands = focused ? 10 : 5;
        for (let row = 0; row < bands; row += 2) {
            stripes.rect(-310, -pitchHeight / 2 + 6 + row * bandHeight, 620, bandHeight); stripes.fill();
        }
        stripes.strokeColor = new Color(190, 226, 194, 190); stripes.lineWidth = 2;
        const halfHeight = pitchHeight / 2 - 11;
        stripes.rect(-300, -halfHeight, 600, halfHeight * 2); stripes.stroke();
        stripes.moveTo(-300, 0); stripes.lineTo(300, 0); stripes.stroke();
        stripes.circle(0, 0, 34); stripes.stroke();
        stripes.rect(-88, -halfHeight, 176, focused ? 70 : 32);
        stripes.rect(-88, halfHeight - (focused ? 70 : 32), 176, focused ? 70 : 32); stripes.stroke();
        this.label(parent, '↑ 进攻', 0, pitchY + pitchHeight / 2 - 38, 14, 96,
            new Color(220, 243, 222));
        this.label(parent, '己方球门', 0, pitchY - pitchHeight / 2 + 18, 15, 150,
            new Color(205, 234, 210));
    }

    private activeCardPosition(position: Vector2Data): Vector2Data {
        return this.formationFocused
            ? { x: position.x * 78, y: 70 + (position.y + 3) * 170 }
            : { x: position.x * 78, y: 312 + (position.y + 3) * 62 };
    }

    private placeActiveCards(): void {
        if (!this.snapshot) return;
        this.activeCards.forEach(item => {
            const display = this.activeCardPosition(this.snapshot.slotPositions[item.slot]);
            item.node.setPosition(display.x, display.y);
        });
    }

    private focusFormation(): void {
        if (this.formationFocused) return;
        this.formationFocused = true;
        this.compactFormation.active = false;
        this.focusedFormation.active = true;
        this.placeActiveCards();
        this.snapDrawer(false);
    }

    private playerCard(templateId: string, active: boolean): Node {
        const template = getPlayerTemplate(this.catalog, templateId);
        const card = this.panel(this.content, `Player-${templateId}`, 302, 202, 0, 0,
            new Color(225, 239, 225), 20);
        const border = card.getComponent(Graphics)!; border.strokeColor = new Color(75, 143, 135);
        border.lineWidth = 3; border.stroke();
        this.avatar(card, templateId, 84, -92, 42);
        this.label(card, template.name, 48, 68, 25, 170, new Color(26, 70, 69));
        this.label(card, `重 ${template.weight}　力 ${template.power}`, 48, 33, 17, 180, new Color(63, 96, 88));
        this.label(card, `准 ${template.precision}　心 ${template.mentality}　弧 ${template.curve}`,
            48, 6, 16, 190, new Color(63, 96, 88));
        this.button(card, '信息', -72, -68, 132, 48, new Color(70, 127, 132));
        this.button(card, active ? '已上场' : '上场', 72, -68, 132, 48,
            active ? new Color(125, 151, 142) : new Color(47, 171, 105));
        return card;
    }

    private showInfo(templateId: string): void {
        const template = getPlayerTemplate(this.catalog, templateId);
        const overall = this.overall(template);
        const overlay = this.node(this.root, `Info-${templateId}`, 720, 1280); overlay.setSiblingIndex(this.root.children.length - 1);
        const shade = overlay.addComponent(Graphics); shade.fillColor = new Color(3, 15, 20, 220);
        shade.rect(-360, -640, 720, 1280); shade.fill();

        this.panel(overlay, 'InfoShadow', 680, 1170, 0, -9, new Color(4, 23, 29, 230), 34);
        const card = this.panel(overlay, 'InfoCard', 672, 1170, 0, 0, new Color(235, 244, 235), 32);
        const frame = card.getComponent(Graphics)!; frame.strokeColor = new Color(58, 130, 124);
        frame.lineWidth = 7; frame.stroke();

        const header = this.panel(card, 'Header', 666, 90, 0, 535, new Color(44, 75, 88), 29);
        const headerLine = header.getComponent(Graphics)!; headerLine.strokeColor = new Color(137, 205, 202);
        headerLine.lineWidth = 3; headerLine.stroke();
        this.soccerBall(header, 48, -138, 0);
        this.label(header, '球员信息', 10, 0, 34, 300);
        const close = this.panel(card, 'Close', 62, 62, infoCloseCenter.x, infoCloseCenter.y,
            new Color(223, 40, 54), 13);
        const closeBorder = close.getComponent(Graphics)!; closeBorder.strokeColor = new Color(128, 18, 30);
        closeBorder.lineWidth = 4; closeBorder.stroke();
        this.closeIcon(close);

        this.portraitMedallion(card, templateId, -226, 376);
        const portraitTag = this.panel(card, 'PortraitTag', 132, 42, -226, 280,
            new Color(28, 186, 69), 18);
        const tagBorder = portraitTag.getComponent(Graphics)!; tagBorder.strokeColor = new Color(16, 111, 45);
        tagBorder.lineWidth = 3; tagBorder.stroke();
        this.label(portraitTag, '球员卡', 0, 0, 19, 118);

        this.panel(card, 'IdentityShadow', 402, 130, 102, 388,
            new Color(182, 90, 39, 140), 18);
        const identity = this.panel(card, 'Identity', 402, 130, 102, 397,
            new Color(247, 126, 54), 18);
        const identityBorder = identity.getComponent(Graphics)!; identityBorder.strokeColor = new Color(255, 207, 148);
        identityBorder.lineWidth = 3; identityBorder.stroke();
        this.label(identity, template.name, -70, 24, 35, 220);
        this.label(identity, '五维能力档案 · 评分 0—100', -68, -23, 18, 230, new Color(255, 239, 219));
        const rating = this.panel(identity, 'Overall', 92, 96, 137, 0, new Color(194, 84, 37, 210), 14);
        this.label(rating, '综合', 0, 24, 16, 82, new Color(255, 229, 202));
        this.label(rating, String(overall), 0, -15, 34, 82);

        const quipPanel = this.panel(card, 'Quip', 402, 94, 102, 276, new Color(249, 252, 244), 17);
        const quipBorder = quipPanel.getComponent(Graphics)!; quipBorder.strokeColor = new Color(203, 217, 205);
        quipBorder.lineWidth = 2; quipBorder.stroke();
        const quip = this.label(quipPanel, `“${template.quip}”`, 0, 0, 20, 370, new Color(38, 62, 74));
        quip.enableWrapText = true; quip.lineHeight = 27;
        quip.node.getComponent(UITransform)?.setContentSize(370, 76);

        this.label(card, '能力属性', -252, 204, 23, 150, new Color(35, 80, 83));
        this.label(card, '评分范围 0—100', 220, 204, 16, 190, new Color(102, 128, 122));
        this.stat(card, '重量', template.weight, -157, 132, 'weight');
        this.stat(card, '力量', template.power, 157, 132, 'power');
        this.stat(card, '精准', template.precision, -157, 16, 'precision');
        this.stat(card, '弧度', template.curve, 157, 16, 'curve');
        this.stat(card, '心态', template.mentality, -157, -100, 'mentality');

        const skills = this.panel(card, 'Skills', 628, 164, 0, -246, new Color(250, 252, 246), 19);
        const skillsGraphic = skills.getComponent(Graphics)!; skillsGraphic.strokeColor = new Color(147, 174, 156);
        skillsGraphic.lineWidth = 3; skillsGraphic.stroke();
        this.skillIcon(skills, -242, 0);
        const skill = playerSkillPresentation(template);
        this.label(skills, skill ? `【${skill.name}】` : '【专属技能】', 28, 45, 25, 430,
            new Color(226, 83, 37));
        const skillText = skill
            ? skill.description
            : '技能系统尚未启用，效果与解锁条件将在后续版本确定。';
        const placeholder = this.label(skills, skillText, 52, -2, 19, 420, new Color(44, 66, 78));
        placeholder.enableWrapText = true; placeholder.lineHeight = 27;
        placeholder.node.getComponent(UITransform)?.setContentSize(420, 64);
        this.label(skills, skill ? '已启用' : '敬请期待', 218, -57, 17, 150,
            skill ? new Color(24, 146, 58) : new Color(225, 47, 48));

        this.pitchDecoration(card);
        this.panel(card, 'ActionShadow', 316, 72, 0, -507, new Color(13, 91, 38), 19);
        const footer = this.button(card, '返回仓库', infoFooterCenter.x, infoFooterCenter.y,
            306, 68, new Color(24, 202, 67));
        const footerBorder = footer.getComponent(Graphics)!; footerBorder.strokeColor = new Color(13, 116, 42);
        footerBorder.lineWidth = 4; footerBorder.stroke();
        this.infoPanel = overlay;
    }

    private closeInfo(): void {
        this.infoPanel?.destroy(); this.infoPanel = undefined;
    }

    private overall(template: PlayerTemplate): number {
        return Math.round((template.weight + template.power + template.precision
            + template.mentality + template.curve) / 5);
    }

    private stat(parent: Node, name: string, value: number, x: number, y: number, icon: StatIcon): void {
        this.panel(parent, `StatShadow-${name}`, 296, 106, x, y - 3, new Color(167, 185, 178, 150), 16);
        const tile = this.panel(parent, `Stat-${name}`, 296, 106, x, y, new Color(250, 253, 249), 16);
        const g = tile.getComponent(Graphics)!; g.strokeColor = new Color(211, 223, 217); g.lineWidth = 2; g.stroke();
        this.statIcon(tile, icon, -111, 14);
        this.label(tile, name, -43, 27, 21, 96, new Color(34, 59, 73));
        this.label(tile, String(value), 106, 27, 29, 62, new Color(22, 111, 43));
        const filled = Math.max(0, Math.min(8, Math.round(value / 12.5)));
        for (let index = 0; index < 8; index++) {
            const color = index < filled ? new Color(39, 216, 70) : new Color(166, 177, 187);
            const segment = this.panel(tile, `Segment-${index}`, 21, 15, -61 + index * 25, -27, color, 4);
            const segmentGraphic = segment.getComponent(Graphics)!;
            segmentGraphic.strokeColor = index < filled ? new Color(16, 164, 45) : new Color(126, 138, 150);
            segmentGraphic.lineWidth = 1; segmentGraphic.stroke();
        }
    }

    private hitInfoClose(point: Vector2Data): boolean {
        const top = Math.abs(point.x - infoCloseCenter.x) <= 38
            && Math.abs(point.y - infoCloseCenter.y) <= 38;
        const footer = Math.abs(point.x - infoFooterCenter.x) <= 160
            && Math.abs(point.y - infoFooterCenter.y) <= 40;
        return top || footer;
    }

    private portraitMedallion(parent: Node, templateId: string, x: number, y: number): void {
        this.circle(parent, 'PortraitShadow', 200, x, y - 6, new Color(11, 38, 53, 190));
        this.circle(parent, 'PortraitOuter', 200, x, y, new Color(43, 78, 101), new Color(17, 48, 65), 4);
        this.circle(parent, 'PortraitRing', 184, x, y, new Color(112, 196, 225), new Color(225, 246, 244), 3);
        this.circle(parent, 'PortraitAccent', 170, x, y, new Color(248, 102, 43));
        this.avatar(parent, templateId, 160, x, y);
    }

    private statIcon(parent: Node, icon: StatIcon, x: number, y: number): void {
        const tile = this.panel(parent, `Icon-${icon}`, 58, 58, x, y, new Color(35, 58, 74), 11);
        const border = tile.getComponent(Graphics)!; border.strokeColor = new Color(18, 36, 50);
        border.lineWidth = 2; border.stroke();
        const art = this.node(tile, 'Art', 50, 50).addComponent(Graphics);
        art.strokeColor = new Color(239, 246, 244); art.fillColor = new Color(255, 177, 60); art.lineWidth = 5;
        if (icon === 'weight') {
            art.moveTo(-16, 0); art.lineTo(16, 0); art.stroke();
            art.fillColor = new Color(255, 177, 60);
            art.roundRect(-23, -12, 7, 24, 3); art.roundRect(16, -12, 7, 24, 3);
            art.roundRect(-14, -8, 5, 16, 2); art.roundRect(9, -8, 5, 16, 2); art.fill();
        } else if (icon === 'power') {
            art.fillColor = new Color(255, 162, 49);
            art.moveTo(3, 23); art.lineTo(-16, 2); art.lineTo(-3, 2);
            art.lineTo(-8, -22); art.lineTo(17, 7); art.lineTo(4, 7); art.lineTo(3, 23); art.fill();
        } else if (icon === 'precision') {
            art.strokeColor = new Color(240, 246, 244); art.lineWidth = 4;
            art.circle(0, 0, 15); art.stroke(); art.circle(0, 0, 5); art.stroke();
            art.moveTo(-23, 0); art.lineTo(-10, 0); art.moveTo(10, 0); art.lineTo(23, 0);
            art.moveTo(0, -23); art.lineTo(0, -10); art.moveTo(0, 10); art.lineTo(0, 23); art.stroke();
        } else if (icon === 'mentality') {
            art.fillColor = new Color(242, 58, 76);
            art.circle(-9, 8, 11); art.circle(9, 8, 11); art.fill();
            art.moveTo(-19, 6); art.lineTo(0, -21); art.lineTo(19, 6); art.fill();
            art.strokeColor = new Color(255, 215, 84); art.lineWidth = 4;
            art.moveTo(-14, 0); art.lineTo(-5, 0); art.lineTo(0, 8); art.lineTo(6, -8); art.lineTo(13, -8); art.stroke();
        } else {
            art.strokeColor = new Color(239, 246, 244); art.lineWidth = 5;
            for (let line = 0; line < 2; line++) {
                for (let step = 0; step <= 12; step++) {
                    const progress = step / 12;
                    const px = -20 + progress * 40;
                    const py = -11 + line * 10 + Math.sin(progress * Math.PI) * 21;
                    if (step === 0) art.moveTo(px, py); else art.lineTo(px, py);
                }
                art.stroke();
            }
        }
    }

    private skillIcon(parent: Node, x: number, y: number): void {
        const tile = this.panel(parent, 'SkillIcon', 108, 108, x, y, new Color(255, 177, 25), 17);
        const border = tile.getComponent(Graphics)!; border.strokeColor = new Color(240, 107, 18);
        border.lineWidth = 3; border.stroke();
        const art = this.node(tile, 'SkillArt', 98, 98).addComponent(Graphics);
        art.strokeColor = new Color(255, 246, 178); art.lineWidth = 5;
        for (let ray = 0; ray < 10; ray++) {
            const angle = ray * Math.PI * 2 / 10;
            art.moveTo(Math.cos(angle) * 25, Math.sin(angle) * 25);
            art.lineTo(Math.cos(angle) * 43, Math.sin(angle) * 43);
        }
        art.stroke();
        art.fillColor = new Color(147, 60, 15);
        art.circle(0, 0, 27); art.fill();
        art.strokeColor = new Color(255, 232, 101); art.lineWidth = 5;
        art.moveTo(-19, 8); art.lineTo(-9, -8); art.lineTo(0, 7); art.lineTo(10, -8); art.lineTo(20, 8);
        art.moveTo(-17, -11); art.lineTo(17, -11); art.stroke();
    }

    private pitchDecoration(parent: Node): void {
        const pitch = this.panel(parent, 'Pitch', 638, 220, 0, -455, new Color(116, 183, 119), 20);
        const lines = pitch.getComponent(Graphics)!; lines.strokeColor = new Color(228, 246, 222, 145);
        lines.lineWidth = 3; lines.rect(-292, -93, 584, 186); lines.stroke();
        lines.moveTo(0, -93); lines.lineTo(0, 93); lines.stroke();
        lines.circle(0, 0, 42); lines.stroke();
        lines.rect(-292, -54, 72, 108); lines.rect(220, -54, 72, 108); lines.stroke();
        this.soccerBall(pitch, 50, -277, -75);
        this.soccerBall(pitch, 50, 277, -75);
    }

    private soccerBall(parent: Node, size: number, x: number, y: number): void {
        const node = this.node(parent, 'SoccerBall', size, size); node.setPosition(x, y);
        const art = node.addComponent(Graphics); const radius = size / 2 - 2;
        art.fillColor = new Color(247, 250, 248); art.circle(0, 0, radius); art.fill();
        art.strokeColor = new Color(24, 42, 54); art.lineWidth = Math.max(2, size * 0.06);
        art.circle(0, 0, radius); art.stroke();
        art.fillColor = new Color(32, 48, 60);
        this.pentagon(art, 0, 0, radius * 0.36, -Math.PI / 2);
        for (let panel = 0; panel < 5; panel++) {
            const angle = -Math.PI / 2 + panel * Math.PI * 2 / 5;
            this.pentagon(art, Math.cos(angle) * radius * 0.72, Math.sin(angle) * radius * 0.72,
                radius * 0.22, angle);
            art.moveTo(Math.cos(angle) * radius * 0.34, Math.sin(angle) * radius * 0.34);
            art.lineTo(Math.cos(angle) * radius * 0.53, Math.sin(angle) * radius * 0.53); art.stroke();
        }
    }

    private pentagon(graphics: Graphics, x: number, y: number, radius: number, rotation: number): void {
        for (let vertex = 0; vertex <= 5; vertex++) {
            const angle = rotation + (vertex % 5) * Math.PI * 2 / 5;
            const px = x + Math.cos(angle) * radius; const py = y + Math.sin(angle) * radius;
            if (vertex === 0) graphics.moveTo(px, py); else graphics.lineTo(px, py);
        }
        graphics.fill();
    }

    private closeIcon(parent: Node): void {
        const art = this.node(parent, 'CloseIcon', 48, 48).addComponent(Graphics);
        art.strokeColor = Color.WHITE; art.lineWidth = 9;
        art.moveTo(-14, -14); art.lineTo(14, 14); art.moveTo(-14, 14); art.lineTo(14, -14); art.stroke();
    }

    private circle(parent: Node, name: string, diameter: number, x: number, y: number,
        fill: Color, stroke?: Color, lineWidth = 0): Node {
        const node = this.node(parent, name, diameter, diameter); node.setPosition(x, y);
        const graphics = node.addComponent(Graphics); graphics.fillColor = fill;
        graphics.circle(0, 0, diameter / 2); graphics.fill();
        if (stroke && lineWidth > 0) {
            graphics.strokeColor = stroke; graphics.lineWidth = lineWidth;
            graphics.circle(0, 0, diameter / 2 - lineWidth / 2); graphics.stroke();
        }
        return node;
    }

    private drawerTop(): number {
        return this.drawer.position.y + drawerHeight / 2;
    }

    private hitDrawerHandle(point: Vector2Data): boolean {
        const top = this.drawerTop();
        return Math.abs(point.x) <= 338 && point.y <= top + 8 && point.y >= top - 106;
    }

    private hitFormation(point: Vector2Data): FormationId | null {
        for (const item of this.formationButtons) {
            if (Math.abs(point.x - item.node.position.x) <= 87
                && Math.abs(point.y - item.node.position.y) <= 25) return item.id;
        }
        return null;
    }

    private hitSlot(point: Vector2Data): number | null {
        for (const item of this.activeCards) {
            if (Math.abs(point.x - item.node.position.x) <= 49
                && Math.abs(point.y - item.node.position.y) <= 53) return item.slot;
        }
        return null;
    }

    private hitCardAction(point: Vector2Data): { templateId: string; action: CardAction } | null {
        if (!this.insideViewport(point)) return null;
        const localY = point.y - this.drawer.position.y - this.viewport.position.y;
        for (const item of this.playerCards) {
            const x = point.x - item.node.position.x; const y = localY - item.node.position.y;
            if (Math.abs(y + 68) <= 27 && Math.abs(x + 72) <= 68) return { templateId: item.id, action: 'info' };
            if (Math.abs(y + 68) <= 27 && Math.abs(x - 72) <= 68) return { templateId: item.id, action: 'deploy' };
        }
        return null;
    }

    private insideViewport(point: Vector2Data): boolean {
        const localY = point.y - this.drawer.position.y - this.viewport.position.y;
        return Math.abs(point.x) <= 330 && Math.abs(localY) <= viewportHeight / 2;
    }
    private maxScroll(): number {
        const rows = Math.ceil(this.playerCards.length / 2);
        const visibleHeight = 660 + this.drawerProgress * 260;
        return Math.max(0, rows * rowStep - visibleHeight);
    }
    private placeCards(): void {
        this.playerCards.forEach((item, index) => item.node.setPosition(index % 2 === 0 ? -158 : 158,
            listStartY - Math.floor(index / 2) * rowStep + this.scrollOffset));
    }
    private setDrawerProgress(progress: number): void {
        this.drawerProgress = Math.max(0, Math.min(1, progress));
        const restingTop = this.restingDrawerTop();
        const top = restingTop + (expandedDrawerTop - restingTop) * this.drawerProgress;
        this.drawer.setPosition(0, top - drawerHeight / 2);
        this.drawerHint.string = this.drawerProgress >= 0.5 ? '下拉恢复阵型' : '上拉展开全屏';
        this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll());
        this.placeCards();
    }
    private snapDrawer(expanded: boolean): void {
        if (this.drawerAnimating) return;
        const target = expanded ? 1 : 0;
        const targetTop = expanded ? expandedDrawerTop : this.restingDrawerTop();
        const distance = Math.abs(this.drawerTop() - targetTop);
        if (distance < 0.5) { this.setDrawerProgress(target); return; }
        this.drawerAnimating = true;
        this.drawerHint.string = expanded ? '下拉恢复阵型' : '上拉展开全屏';
        const travel = expandedDrawerTop - this.restingDrawerTop();
        tween(this.drawer).to(Math.max(0.08, Math.min(0.28, distance / travel * 0.28)),
            { position: new Vec3(0, targetTop - drawerHeight / 2, 0) }, { easing: 'quadOut' })
            .call(() => {
                this.drawerAnimating = false;
                this.setDrawerProgress(target);
            }).start();
    }
    private restingDrawerTop(): number { return this.formationFocused ? focusedDrawerTop : collapsedDrawerTop; }
    private navigationPoint(point: Vector2Data): Vector2Data {
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.navigationTransform.convertToNodeSpaceAR(world);
        return { x: local.x, y: local.y };
    }
    private local(point: Vector2Data): Vector2Data {
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(world);
        return { x: local.x, y: local.y };
    }
    private avatar(parent: Node, templateId: string, size: number, x: number, y: number): Node {
        const frame = this.portraits.get(templateId);
        const template = getPlayerTemplate(this.catalog, templateId);
        const avatar = this.node(parent, `Avatar-${templateId}`, size, size); avatar.setPosition(x, y);
        if (frame) {
            const mask = avatar.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
            const image = this.node(avatar, 'Image', size, size);
            const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        } else {
            const art = avatar.addComponent(Graphics); art.fillColor = new Color(30, 105, 111);
            art.circle(0, 0, size / 2); art.fill();
            art.strokeColor = new Color(204, 242, 229); art.lineWidth = Math.max(2, size * 0.035);
            art.circle(0, 0, size / 2 - 2); art.stroke();
            this.label(avatar, template.name, 0, 0, template.name.length > 5 ? 18 : 22,
                size - 10, new Color(246, 252, 244));
        }
        return avatar;
    }
    private button(parent: Node, text: string, x: number, y: number, width: number, height: number,
        color: Color): Node {
        const button = this.panel(parent, `Button-${text}`, width, height, x, y, color, 12);
        this.label(button, text, 0, 0, 20, width - 6); return button;
    }
    private panel(parent: Node, name: string, width: number, height: number,
        x: number, y: number, color: Color, radius: number): Node {
        const node = this.node(parent, name, width, height); node.setPosition(x, y);
        const graphics = node.addComponent(Graphics); graphics.fillColor = color;
        if (radius) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        else graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill(); return node;
    }
    private node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); return node;
    }
    private label(parent: Node, text: string, x: number, y: number, size: number, width: number,
        color = new Color(235, 247, 244)): Label {
        const node = this.node(parent, 'Text', width, size + 24); node.setPosition(x, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size; label.lineHeight = size + 5;
        label.horizontalAlign = Label.HorizontalAlign.CENTER; label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = color; return label;
    }
    dispose(): void {
        this.touch = undefined; this.closeInfo();
        if (isValid(this.root, true)) this.root.destroy();
    }
}
