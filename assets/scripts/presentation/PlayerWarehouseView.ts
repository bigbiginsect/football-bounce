import { Canvas, Camera, Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Vec3, isValid } from 'cc';
import type { Vector2Data } from '../core/GameState';
import type { PlayerCatalog, PlayerTemplate } from '../core/PlayerCatalog';
import { getPlayerTemplate } from '../core/PlayerCatalog';
import type { WarehouseCommand, WarehouseSnapshot } from '../application/PlayerWarehouse';

type CardAction = 'info' | 'deploy';
type Touch = {
    id: number;
    start: Vector2Data;
    last: Vector2Data;
    mode: 'navigate' | 'back' | 'slot' | 'action' | 'scroll' | 'modal';
    slot?: number;
    templateId?: string;
    action?: CardAction | 'close';
};

export interface WarehouseNavigation {
    readonly previewBack: (progress: number) => void;
    readonly finishBack: (complete: boolean) => void;
}

const slotXs = [-240, -120, 0, 120, 240] as const;
const viewportY = -92;
const viewportHeight = 700;
const rowStep = 220;

/** 独立球员仓库表现层；所有上阵修改经 PlayerWarehouse/LineupEditor 执行。 */
export class PlayerWarehouseView {
    readonly root: Node;
    private readonly camera: Camera;
    private readonly navigationTransform: UITransform;
    private readonly viewport: Node;
    private readonly content: Node;
    private readonly sideLabel: Label;
    private readonly activeCards: Node[] = [];
    private readonly playerCards: { id: string; node: Node }[] = [];
    private snapshot!: WarehouseSnapshot;
    private scrollOffset = 0;
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
        this.panel(this.root, 'TopGlow', 720, 180, 0, 550, new Color(24, 91, 91), 0);
        this.button(this.root, '← 返回阵容', -255, 579, 166, 58, new Color(39, 104, 108));
        this.label(this.root, '球员仓库', 0, 585, 38, 350);
        this.sideLabel = this.label(this.root, '', 0, 536, 20, 680);
        this.label(this.root, '← 顶部或右边缘左滑返回', 220, 492, 17, 260, new Color(151, 211, 205));

        this.panel(this.root, 'ActivePanel', 666, 174, 0, 406, new Color(17, 55, 62), 22);
        this.label(this.root, '当前上阵 · 先选择要替换的槽位', -125, 469, 22, 390);

        this.viewport = this.node(this.root, 'WarehouseViewport', 660, viewportHeight);
        this.viewport.setPosition(0, viewportY);
        const mask = this.viewport.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_RECT;
        this.content = this.node(this.viewport, 'WarehouseContent', 660, viewportHeight);
        this.label(this.root, '上下滑动浏览球员　·　每名球员都可查看信息或上场', 0, -602, 18, 680,
            new Color(166, 207, 203));
    }

    setSnapshot(snapshot: WarehouseSnapshot): void {
        this.snapshot = snapshot;
        this.sideLabel.string = `${snapshot.side === 'blue' ? '蓝队' : '红队'}阵容　·　已选择第 ${snapshot.selectedSlot + 1} 槽`;
        this.sideLabel.color = snapshot.side === 'blue' ? new Color(112, 201, 255) : new Color(255, 139, 139);
        for (const node of this.activeCards) node.destroy();
        for (const item of this.playerCards) item.node.destroy();
        this.activeCards.length = 0; this.playerCards.length = 0;
        snapshot.active.forEach((templateId, slot) => {
            const selected = slot === snapshot.selectedSlot;
            const card = this.activeCard(templateId, slot, selected);
            card.setPosition(slotXs[slot], 404);
            this.activeCards.push(card);
        });
        snapshot.players.forEach((templateId, index) => {
            const card = this.playerCard(templateId, snapshot.active.indexOf(templateId) >= 0);
            const column = index % 2; const row = Math.floor(index / 2);
            card.setPosition(column === 0 ? -158 : 158, 238 - row * rowStep + this.scrollOffset);
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
                action: point.x >= 238 && point.x <= 322 && point.y >= 422 && point.y <= 505 ? 'close' : undefined };
            return true;
        }
        if (point.x >= -338 && point.x <= -172 && point.y >= 548 && point.y <= 610) {
            this.touch = { id, start: point, last: point, mode: 'back' }; return true;
        }
        if (point.y >= 490 || point.x >= 300) {
            const navPoint = this.navigationPoint(screenPoint);
            this.touch = { id, start: navPoint, last: navPoint, mode: 'navigate' };
            this.navigation.previewBack(0); return true;
        }
        const slot = this.hitSlot(point);
        if (slot !== null) {
            this.touch = { id, start: point, last: point, mode: 'slot', slot }; return true;
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
        const point = this.local(screenPoint); this.touch = undefined;
        if (Math.hypot(point.x - touch.start.x, point.y - touch.start.y) > 24) return;
        if (touch.mode === 'back') { this.navigation.finishBack(true); return; }
        if (touch.mode === 'modal') {
            if (touch.action === 'close') this.closeInfo();
            return;
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
        const navigation = this.touch?.mode === 'navigate'; this.touch = undefined;
        if (navigation) this.navigation.finishBack(false);
    }

    private activeCard(templateId: string, slot: number, selected: boolean): Node {
        const template = getPlayerTemplate(this.catalog, templateId);
        const card = this.panel(this.root, `Active-${templateId}`, 106, 116, 0, 0,
            selected ? new Color(42, 125, 105) : new Color(25, 72, 77), 16);
        const g = card.getComponent(Graphics)!; g.strokeColor = selected
            ? new Color(255, 221, 103) : new Color(104, 166, 163); g.lineWidth = selected ? 5 : 2; g.stroke();
        this.avatar(card, templateId, 62, 0, 17);
        this.label(card, template.name, 0, -28, 16, 102);
        this.label(card, `槽 ${slot + 1}`, 0, -49, 14, 102,
            selected ? new Color(255, 231, 132) : new Color(175, 209, 205));
        return card;
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
        const overlay = this.node(this.root, `Info-${templateId}`, 720, 1280); overlay.setSiblingIndex(this.root.children.length - 1);
        const shade = overlay.addComponent(Graphics); shade.fillColor = new Color(3, 15, 20, 205);
        shade.rect(-360, -640, 720, 1280); shade.fill();
        const card = this.panel(overlay, 'InfoCard', 620, 1010, 0, 0, new Color(230, 240, 225), 28);
        const frame = card.getComponent(Graphics)!; frame.strokeColor = new Color(58, 130, 124);
        frame.lineWidth = 6; frame.stroke();
        this.panel(card, 'Header', 620, 86, 0, 462, new Color(55, 126, 117), 26);
        this.label(card, '球员信息卡', 0, 462, 28, 420);
        this.button(card, '×', 276, 462, 58, 58, new Color(190, 68, 62));
        this.avatar(card, templateId, 174, -198, 330);
        this.panel(card, 'NameBand', 318, 88, 106, 374, new Color(235, 145, 82), 14);
        this.label(card, template.name, 106, 386, 31, 300);
        this.label(card, '球队里的快乐制造机', 106, 352, 17, 300, new Color(255, 239, 215));
        const quipPanel = this.panel(card, 'Quip', 350, 128, 106, 266, new Color(246, 249, 239), 14);
        const quip = this.label(quipPanel, template.quip, 0, 0, 20, 318, new Color(49, 76, 68));
        quip.enableWrapText = true; quip.lineHeight = 28;
        quip.node.getComponent(UITransform)?.setContentSize(318, 106);

        this.label(card, '球员参数', -214, 164, 24, 180, new Color(36, 93, 87));
        this.stat(card, '重量', template.weight, -198, 92, new Color(206, 104, 69));
        this.stat(card, '力量', template.power, 0, 92, new Color(228, 142, 64));
        this.stat(card, '精准', template.precision, 198, 92, new Color(65, 140, 193));
        this.stat(card, '心态', template.mentality, -100, -22, new Color(99, 161, 91));
        this.stat(card, '弧度', template.curve, 100, -22, new Color(133, 96, 179));

        const skills = this.panel(card, 'Skills', 548, 250, 0, -270, new Color(247, 249, 239), 18);
        const skillsGraphic = skills.getComponent(Graphics)!; skillsGraphic.strokeColor = new Color(151, 178, 157);
        skillsGraphic.lineWidth = 2; skillsGraphic.stroke();
        this.label(skills, '技能', -220, 88, 25, 90, new Color(37, 91, 84));
        this.panel(skills, 'SkillIcon', 82, 82, -205, 5, new Color(210, 224, 204), 14);
        this.label(skills, '?', -205, 5, 36, 70, new Color(91, 125, 111));
        const placeholder = this.label(skills, '技能槽位预留\n名称与描述将在后续补充', 58, 0, 20, 360,
            new Color(102, 123, 111));
        placeholder.enableWrapText = true; placeholder.lineHeight = 29;
        placeholder.node.getComponent(UITransform)?.setContentSize(360, 120);
        this.infoPanel = overlay;
    }

    private closeInfo(): void {
        this.infoPanel?.destroy(); this.infoPanel = undefined;
    }

    private stat(parent: Node, name: string, value: number, x: number, y: number, color: Color): void {
        const tile = this.panel(parent, `Stat-${name}`, 174, 92, x, y, new Color(239, 246, 235), 14);
        const g = tile.getComponent(Graphics)!; g.strokeColor = color; g.lineWidth = 3; g.stroke();
        this.label(tile, name, -42, 0, 19, 82, new Color(60, 83, 76));
        this.label(tile, String(value), 45, 0, 28, 72, color);
    }

    private hitSlot(point: Vector2Data): number | null {
        const slot = slotXs.findIndex(x => Math.abs(point.x - x) <= 54 && Math.abs(point.y - 404) <= 59);
        return slot < 0 ? null : slot;
    }

    private hitCardAction(point: Vector2Data): { templateId: string; action: CardAction } | null {
        if (!this.insideViewport(point)) return null;
        const localY = point.y - viewportY;
        for (const item of this.playerCards) {
            const x = point.x - item.node.position.x; const y = localY - item.node.position.y;
            if (Math.abs(y + 68) <= 27 && Math.abs(x + 72) <= 68) return { templateId: item.id, action: 'info' };
            if (Math.abs(y + 68) <= 27 && Math.abs(x - 72) <= 68) return { templateId: item.id, action: 'deploy' };
        }
        return null;
    }

    private insideViewport(point: Vector2Data): boolean {
        return Math.abs(point.x) <= 330 && Math.abs(point.y - viewportY) <= viewportHeight / 2;
    }
    private maxScroll(): number {
        const rows = Math.ceil(this.playerCards.length / 2);
        return Math.max(0, rows * rowStep - 660);
    }
    private placeCards(): void {
        this.playerCards.forEach((item, index) => item.node.setPosition(index % 2 === 0 ? -158 : 158,
            238 - Math.floor(index / 2) * rowStep + this.scrollOffset));
    }
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
        if (!frame) throw new Error(`缺少头像资源：${templateId}`);
        const avatar = this.node(parent, `Avatar-${templateId}`, size, size); avatar.setPosition(x, y);
        const mask = avatar.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
        const image = this.node(avatar, 'Image', size, size);
        const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
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
