import { Canvas, Camera, Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Vec3, isValid } from 'cc';
import type { Vector2Data } from '../core/GameState';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import { getPlayerTemplate } from '../core/PlayerCatalog';
import { formationPositions } from '../core/Lineup';
import type { LineupDraftSnapshot, LineupEdit } from '../application/LineupEditor';

type Source = { kind: 'bench'; templateId: string } | { kind: 'slot'; slot: number; templateId: string };
type Touch = { id: number; start: Vector2Data; last: Vector2Data; source?: Source;
    mode: 'pending' | 'scroll' | 'drag' | 'button' | 'navigate'; button?: 'back' | 'confirm' };
export interface LineupNavigation {
    readonly previewWarehouse: (progress: number) => void;
    readonly finishWarehouse: (complete: boolean) => void;
}
const slots: readonly Vector2Data[] = [
    { x: -132, y: -150 }, { x: 132, y: -150 }, { x: 0, y: -6 },
    { x: -132, y: 138 }, { x: 132, y: 138 },
];
const cardStep = 154;
const viewportWidth = 624;

/** 仅负责赛前展示与触摸意图；阵容变更由 LineupEditor 执行。 */
export class LineupView {
    readonly root: Node;
    private readonly camera: Camera;
    private readonly navigationTransform: UITransform;
    private readonly viewport: Node;
    private readonly slotLayer: Node;
    private readonly title: Label;
    private readonly subtitle: Label;
    private readonly benchTitle: Label;
    private readonly confirmLabel: Label;
    private readonly backButton: Node;
    private readonly targetRing: Graphics;
    private snapshot!: LineupDraftSnapshot;
    private slotPoints: readonly Vector2Data[] = slots;
    private readonly slotCards: Node[] = [];
    private readonly benchCards: Node[] = [];
    private scrollOffset = 0;
    private touch?: Touch;
    private ghost?: Node;

    constructor(parent: Node, private readonly catalog: PlayerCatalog,
        private readonly portraits: ReadonlyMap<string, SpriteFrame>,
        private readonly submit: (edit: LineupEdit) => void,
        private readonly navigation?: LineupNavigation) {
        const camera = parent.getComponent(Canvas)?.cameraComponent;
        const transform = parent.getComponent(UITransform);
        if (!camera || !transform) throw new Error('阵容视图需要 Canvas 相机和 UITransform');
        this.camera = camera; this.navigationTransform = transform;
        this.root = this.node(parent, 'LineupScreen', 720, 1280);
        this.panel(this.root, 'Background', 720, 1280, 0, 0, new Color(9, 27, 37), 0);
        this.panel(this.root, 'TopAccent', 720, 8, 0, 636, new Color(90, 205, 216), 0);
        this.title = this.label(this.root, '', 0, 557, 42, 680);
        this.subtitle = this.label(this.root, '', 0, 505, 21, 680);
        this.label(this.root, '顶部或左边缘向右滑动进入完整球员仓库　→', 0, 461, 18, 650);
        this.panel(this.root, 'PitchFrame', 584, 570, 0, 135, new Color(18, 57, 52), 26);
        const pitch = this.node(this.root, 'Pitch', 548, 540); pitch.setPosition(0, 135);
        const grass = pitch.addComponent(Graphics);
        for (let band = 0; band < 8; band++) {
            grass.fillColor = band % 2 ? new Color(28, 106, 74) : new Color(34, 124, 82);
            grass.rect(-266, -260 + band * 65, 532, 65); grass.fill();
        }
        grass.strokeColor = new Color(193, 239, 206, 145); grass.lineWidth = 3;
        grass.rect(-266, -260, 532, 520);
        grass.moveTo(-266, 234); grass.lineTo(266, 234);
        grass.rect(-125, 195, 250, 65);
        grass.moveTo(-266, -245); grass.lineTo(266, -245);
        grass.stroke();
        this.label(pitch, '↑  进攻方向', 0, 224, 20, 250);
        this.label(pitch, '己方球门', 0, -226, 18, 250);
        this.slotLayer = this.node(pitch, 'SlotCards', 548, 540);
        this.targetRing = this.node(pitch, 'DropTarget', 548, 540).addComponent(Graphics);
        this.panel(this.root, 'BenchPanel', 660, 246, 0, -402, new Color(17, 40, 54), 24);
        this.benchTitle = this.label(this.root, '', -174, -305, 24, 290);
        this.label(this.root, '左右滑动浏览  ·  向上拖入替换', 138, -305, 19, 340);
        this.viewport = this.node(this.root, 'BenchViewport', viewportWidth, 168);
        this.viewport.setPosition(0, -423);
        const mask = this.viewport.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_RECT;
        this.backButton = this.button(-255, -581, 150, '返回蓝队', new Color(48, 72, 88));
        this.button(77, -581, 470, '', new Color(47, 150, 126));
        this.confirmLabel = this.label(this.root, '', 77, -581, 25, 460);
        this.label(this.root, '拖动球员互换站位  ·  松手后生效', 0, -628, 19, 680);
    }

    setDraft(snapshot: LineupDraftSnapshot): void {
        const sideChanged = this.snapshot?.side !== snapshot.side;
        this.snapshot = snapshot;
        if (sideChanged) this.scrollOffset = 0;
        const sideName = snapshot.side === 'blue' ? '蓝队' : '红队';
        this.title.string = `${sideName} · 选择首发`;
        this.title.color = snapshot.side === 'blue' ? new Color(111, 201, 255) : new Color(255, 133, 134);
        this.subtitle.string = snapshot.side === 'blue' ? '第 1 步 / 2  ·  布置蓝队的 5 个位置'
            : '第 2 步 / 2  ·  布置红队的 5 个位置';
        this.confirmLabel.string = snapshot.side === 'blue' ? '确认蓝队  →' : '确认红队  ·  开始比赛';
        this.backButton.active = snapshot.side === 'red';
        this.benchTitle.string = `球员仓库  ${snapshot.bench.length} 人`;
        this.slotPoints = formationPositions(snapshot.formationId, 'blue').map(point => ({
            x: point.x * 82.5,
            y: -6 + (point.y + 3) * (point.y < -3 ? 180 : 144),
        }));
        for (const node of this.slotCards) node.destroy();
        for (const node of this.benchCards) node.destroy();
        this.slotCards.length = 0; this.benchCards.length = 0;
        const selected = snapshot[snapshot.side];
        selected.forEach((id, index) => {
            const card = this.playerCard(this.slotLayer, id, 108, 117, true);
            card.setPosition(this.slotPoints[index].x, this.slotPoints[index].y);
            this.slotCards.push(card);
        });
        snapshot.bench.forEach(id => {
            const card = this.playerCard(this.viewport, id, 142, 148, false);
            this.benchCards.push(card);
        });
        this.scrollOffset = Math.min(this.scrollOffset, this.maxScroll());
        this.placeBenchCards();
    }

    touchStart(id: number, screenPoint: Vector2Data): boolean {
        if (this.touch) return true; // 第二根手指不接管本次手势
        const point = this.local(screenPoint);
        if (this.navigation && (point.y >= 440 || point.x <= -300)) {
            const navigationPoint = this.navigationPoint(screenPoint);
            this.touch = { id, start: navigationPoint, last: navigationPoint, mode: 'navigate' };
            this.navigation.previewWarehouse(0); return true;
        }
        if (point.y >= -617 && point.y <= -545) {
            if (point.x >= -330 && point.x <= -180 && this.snapshot.side === 'red') {
                this.touch = { id, start: point, last: point, mode: 'button', button: 'back' }; return true;
            }
            if (point.x >= -160 && point.x <= 313) {
                this.touch = { id, start: point, last: point, mode: 'button', button: 'confirm' }; return true;
            }
        }
        const slot = this.hitSlot(point);
        if (slot !== null) {
            this.touch = { id, start: point, last: point, mode: 'pending',
                source: { kind: 'slot', slot, templateId: this.snapshot[this.snapshot.side][slot] } };
            return true;
        }
        if (this.insideViewport(point)) {
            const index = this.benchCards.findIndex(card =>
                Math.abs(card.position.x - point.x) <= 71 && Math.abs(point.y + 423) <= 74);
            this.touch = { id, start: point, last: point, mode: 'pending',
                source: index < 0 ? undefined : { kind: 'bench', templateId: this.snapshot.bench[index] } };
            return true;
        }
        return true;
    }

    touchMove(id: number, screenPoint: Vector2Data): void {
        const touch = this.touch;
        if (!touch || touch.id !== id) return;
        if (touch.mode === 'navigate') {
            const point = this.navigationPoint(screenPoint);
            const progress = Math.max(0, Math.min(1, (point.x - touch.start.x) / 720));
            this.navigation?.previewWarehouse(progress); touch.last = point; return;
        }
        const point = this.local(screenPoint);
        const dx = point.x - touch.start.x; const dy = point.y - touch.start.y;
        if (touch.mode === 'pending' && Math.hypot(dx, dy) > 14) {
            if (touch.source?.kind === 'bench' && Math.abs(dx) > Math.abs(dy) * 1.1) touch.mode = 'scroll';
            else if (touch.source) touch.mode = 'drag';
            else touch.mode = 'scroll';
        }
        if (touch.mode === 'scroll') {
            this.scrollOffset = Math.max(0, Math.min(this.maxScroll(),
                this.scrollOffset - (point.x - touch.last.x)));
            this.placeBenchCards();
        } else if (touch.mode === 'drag' && touch.source) {
            if (!this.ghost) this.ghost = this.playerCard(this.root, touch.source.templateId, 112, 120, true);
            this.ghost.setPosition(point.x, point.y); this.ghost.setSiblingIndex(this.root.children.length - 1);
            this.showTarget(this.hitSlot(point));
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
            this.navigation?.finishWarehouse(dx >= 105 && Math.abs(dx) > Math.abs(dy) * 1.15);
            return;
        }
        const point = this.local(screenPoint);
        this.clearGesture();
        if (touch.mode === 'button' && Math.hypot(point.x - touch.start.x, point.y - touch.start.y) < 24) {
            if (touch.button === 'back') this.submit({ type: 'BackToBlue' });
            else if (touch.button === 'confirm') this.submit({ type: 'ConfirmSide' });
            return;
        }
        if (touch.mode !== 'drag' || !touch.source) return;
        const target = this.hitSlot(point);
        if (target === null) return;
        if (touch.source.kind === 'bench') this.submit({
            type: 'ReplaceFromBench', templateId: touch.source.templateId, slot: target });
        else if (target !== touch.source.slot) this.submit({
            type: 'SwapSlots', from: touch.source.slot, to: target });
    }

    touchCancel(id?: number): void {
        if (id !== undefined && this.touch?.id !== id) return;
        const navigation = this.touch?.mode === 'navigate'; this.clearGesture();
        if (navigation) this.navigation?.finishWarehouse(false);
    }

    private clearGesture(): void {
        this.touch = undefined; this.showTarget(null);
        if (this.ghost) { this.ghost.destroy(); this.ghost = undefined; }
    }
    private maxScroll(): number { return Math.max(0, this.benchCards.length * cardStep - viewportWidth + 18); }
    private placeBenchCards(): void {
        this.benchCards.forEach((card, i) => card.setPosition(-viewportWidth / 2 + 78 + i * cardStep - this.scrollOffset, 0));
    }
    private insideViewport(p: Vector2Data): boolean {
        return Math.abs(p.x) <= viewportWidth / 2 && Math.abs(p.y + 423) <= 84;
    }
    private hitSlot(p: Vector2Data): number | null {
        const index = this.slotPoints.findIndex(slot =>
            Math.abs(p.x - slot.x) <= 61 && Math.abs(p.y - 135 - slot.y) <= 67);
        return index < 0 ? null : index;
    }
    private showTarget(index: number | null): void {
        this.targetRing.clear();
        if (index === null) return;
        this.targetRing.strokeColor = new Color(255, 219, 113); this.targetRing.lineWidth = 6;
        this.targetRing.roundRect(this.slotPoints[index].x - 59, this.slotPoints[index].y - 65, 118, 130, 18);
        this.targetRing.stroke();
    }
    private local(point: Vector2Data): Vector2Data {
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(world);
        return { x: local.x, y: local.y };
    }
    private navigationPoint(point: Vector2Data): Vector2Data {
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.navigationTransform.convertToNodeSpaceAR(world);
        return { x: local.x, y: local.y };
    }
    private playerCard(parent: Node, id: string, width: number, height: number, field: boolean): Node {
        const template = getPlayerTemplate(this.catalog, id);
        const frame = this.portraits.get(id);
        if (!frame) throw new Error(`缺少头像资源：${id}`);
        const card = this.node(parent, `Card-${id}`, width, height);
        const g = card.addComponent(Graphics);
        g.fillColor = field ? new Color(11, 42, 54, 235) : new Color(31, 67, 82);
        g.roundRect(-width / 2, -height / 2, width, height, 18); g.fill();
        g.strokeColor = field ? new Color(194, 236, 229, 180) : new Color(92, 168, 184);
        g.lineWidth = 2; g.stroke();
        const size = field ? 74 : 76;
        const avatar = this.node(card, 'Avatar', size, size); avatar.setPosition(0, field ? 15 : 30);
        const mask = avatar.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
        const imageNode = this.node(avatar, 'Image', size, size);
        const sprite = imageNode.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        this.label(card, template.name, 0, field ? -38 : -19, field ? 19 : 22, width - 8);
        if (!field) this.label(card, `重${template.weight}  力${template.power}  准${template.precision}`,
            0, -53, 18, width - 4);
        return card;
    }
    private button(x: number, y: number, width: number, name: string, color: Color): Node {
        const button = this.panel(this.root, name, width, 66, x, y, color, 16);
        if (name) this.label(button, name, 0, 0, 22, width);
        return button;
    }
    private panel(parent: Node, name: string, width: number, height: number,
        x: number, y: number, color: Color, radius: number): Node {
        const node = this.node(parent, name, width, height); node.setPosition(x, y);
        const g = node.addComponent(Graphics); g.fillColor = color;
        if (radius) g.roundRect(-width / 2, -height / 2, width, height, radius);
        else g.rect(-width / 2, -height / 2, width, height);
        g.fill(); return node;
    }
    private node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); return node;
    }
    private label(parent: Node, text: string, x: number, y: number, size: number, width: number): Label {
        const node = this.node(parent, 'Text', width, size + 16); node.setPosition(x, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size;
        label.lineHeight = size + 4; label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER; label.color = new Color(233, 247, 246);
        return label;
    }
    dispose(): void { this.clearGesture(); if (isValid(this.root, true)) this.root.destroy(); }
}
