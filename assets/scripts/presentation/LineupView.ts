import { Canvas, Camera, Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame,
    UITransform, Vec3, isValid } from 'cc';
import type { Vector2Data } from '../core/GameState';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import { getPlayerTemplate, playerRarityPresentation } from '../core/PlayerCatalog';
import { formationDefinitions, formationPositions } from '../core/Lineup';
import type { FormationId } from '../core/Lineup';
import type { LineupDraftSnapshot, LineupEdit } from '../application/LineupEditor';
import { PlayerInfoView } from './PlayerInfoView';

/** 720×1280 设计坐标中的交互初值，按试玩调整，不改变规则层。 */
export const lineupInteraction = Object.freeze({
    holdSeconds: 0.2, moveTolerance: 14, edgeSize: 96, maxEdgeSpeed: 720,
    viewportTop: 470, viewportBottom: -530, viewportWidth: 692,
    benchFirstY: -380, rowStep: 158, benchColumns: 4, benchColumnStep: 160,
    benchCardWidth: 150, benchCardHeight: 146,
});
const viewportHeight = lineupInteraction.viewportTop - lineupInteraction.viewportBottom;
const viewportCenterY = (lineupInteraction.viewportTop + lineupInteraction.viewportBottom) / 2;
type Source = { kind: 'bench'; templateId: string }
    | { kind: 'slot'; slot: number; templateId: string };
type Touch = { id: number; start: Vector2Data; last: Vector2Data; source?: Source;
    mode: 'pending' | 'scroll' | 'drag' | 'button' | 'modal'; heldSeconds: number;
    button?: 'back' | 'confirm'; formationId?: FormationId; close?: boolean };

/** 唯一赛前页面；内容连续滚动，阵容只通过 LineupEditor 修改。 */
export class LineupView {
    readonly root: Node;
    private readonly camera: Camera;
    private readonly content: Node;
    private readonly title: Label;
    private readonly subtitle: Label;
    private readonly benchTitle: Label;
    private readonly confirmLabel: Label;
    private readonly backButton: Node;
    private readonly targetRing: Graphics;
    private readonly info: PlayerInfoView;
    private snapshot!: LineupDraftSnapshot;
    private slotPoints: readonly Vector2Data[] = [];
    private readonly slotCards: Node[] = [];
    private readonly benchCards: Node[] = [];
    private readonly formationButtons: { id: FormationId; node: Node }[] = [];
    private scrollOffset = 0;
    private touch?: Touch;
    private ghost?: Node;

    constructor(parent: Node, private readonly catalog: PlayerCatalog,
        private readonly portraits: ReadonlyMap<string, SpriteFrame>,
        private readonly submit: (edit: LineupEdit) => void) {
        const camera = parent.getComponent(Canvas)?.cameraComponent;
        if (!camera) throw new Error('阵容视图需要 Canvas 相机');
        this.camera = camera;
        this.root = this.node(parent, 'LineupScreen', 720, 1280);
        this.panel(this.root, 'Background', 720, 1280, 0, 0, new Color(9, 27, 37), 0);
        const viewport = this.node(this.root, 'LineupViewport', lineupInteraction.viewportWidth, viewportHeight);
        viewport.setPosition(0, viewportCenterY);
        const mask = viewport.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_RECT;
        this.content = this.node(viewport, 'LineupContent', lineupInteraction.viewportWidth, viewportHeight);
        this.content.setPosition(0, -viewportCenterY);
        this.drawPitch();
        this.benchTitle = this.label(this.content, '', -178, -230, 25, 300);
        this.label(this.content, '上滑浏览 · 长按球员拖入球场', 132, -230, 17, 330);
        this.label(this.content, '轻点查看信息 · 拖到位置后松手换人', 0, -266, 17, 640);
        this.targetRing = this.node(this.content, 'DropTarget', lineupInteraction.viewportWidth, viewportHeight).addComponent(Graphics);
        // 固定标题/操作区与拖动头像均在滚动遮罩之外。
        this.panel(this.root, 'Header', 720, 170, 0, 555, new Color(12, 37, 49), 0);
        this.title = this.label(this.root, '', 0, 585, 35, 680);
        this.subtitle = this.label(this.root, '', 0, 541, 20, 680);
        this.label(this.root, '上下滑动浏览 · 长按拖动换人', 0, 501, 18, 650);
        this.panel(this.root, 'Footer', 720, 110, 0, -585, new Color(12, 37, 49), 0);
        this.backButton = this.button(-255, -581, 150, '返回蓝队', new Color(48, 72, 88));
        this.button(77, -581, 470, '', new Color(47, 150, 126));
        this.confirmLabel = this.label(this.root, '', 77, -581, 25, 460);
        this.label(this.root, '长按首发可拖动交换站位', 0, -630, 16, 680);
        this.info = new PlayerInfoView(this.root, catalog, portraits);
    }

    setDraft(snapshot: LineupDraftSnapshot): void {
        this.clearGesture();
        const sideChanged = this.snapshot?.side !== snapshot.side;
        this.snapshot = snapshot;
        if (sideChanged) { this.scrollOffset = 0; this.info.close(); }
        const sideName = snapshot.side === 'blue' ? '蓝队' : '红队';
        this.title.string = sideName + ' · 选择首发';
        this.title.color = snapshot.side === 'blue' ? new Color(111, 201, 255) : new Color(255, 133, 134);
        this.subtitle.string = snapshot.side === 'blue' ? '第 1 步 / 2 · 布置蓝队的 5 个位置'
            : '第 2 步 / 2 · 布置红队的 5 个位置';
        this.confirmLabel.string = snapshot.side === 'blue' ? '确认蓝队 →' : '确认红队 · 开始比赛';
        this.backButton.active = snapshot.side === 'red';
        this.benchTitle.string = '候补仓库 · ' + snapshot.bench.length + ' 人';
        this.slotPoints = formationPositions(snapshot.formationId, 'blue').map(point => ({
            x: point.x * 90, y: 102 + (point.y + 3) * 170,
        }));
        for (const node of [...this.slotCards, ...this.benchCards]) node.destroy();
        for (const item of this.formationButtons) item.node.destroy();
        this.slotCards.length = 0; this.benchCards.length = 0; this.formationButtons.length = 0;
        formationDefinitions.forEach((formation, index) => {
            const x = (index - 1) * 194;
            const selected = formation.id === snapshot.formationId;
            const node = this.panel(this.content, 'Formation-' + formation.id, 180, 50, x, 433,
                selected ? new Color(47, 150, 126) : new Color(35, 70, 81), 14);
            this.label(node, formation.label, 0, 0, 22, 174);
            this.formationButtons.push({ id: formation.id, node });
        });
        snapshot[snapshot.side].forEach((id, slot) => {
            const card = this.playerCard(this.content, id, true);
            card.setPosition(this.slotPoints[slot].x, this.slotPoints[slot].y);
            this.slotCards.push(card);
        });
        snapshot.bench.forEach((id, index) => {
            const card = this.playerCard(this.content, id, false);
            card.setPosition((index % lineupInteraction.benchColumns - (lineupInteraction.benchColumns - 1) / 2)
                * lineupInteraction.benchColumnStep,
                lineupInteraction.benchFirstY - Math.floor(index / lineupInteraction.benchColumns) * lineupInteraction.rowStep);
            this.benchCards.push(card);
        });
        this.targetRing.node.setSiblingIndex(this.content.children.length - 1);
        this.setScroll(this.scrollOffset);
    }

    touchStart(id: number, screenPoint: Vector2Data): boolean {
        if (this.touch) return true; // 第二触点不接管本次手势。
        const point = this.local(screenPoint);
        if (this.info.isOpen) {
            this.touch = { id, start: point, last: point, mode: 'modal', heldSeconds: 0,
                close: this.info.hitClose(point) }; return true;
        }
        if (point.y >= -617 && point.y <= -545) {
            const button = point.x >= -330 && point.x <= -180 && this.snapshot.side === 'red' ? 'back'
                : point.x >= -160 && point.x <= 313 ? 'confirm' : undefined;
            if (button) this.touch = { id, start: point, last: point, mode: 'button', heldSeconds: 0, button };
            return true;
        }
        if (!this.insideViewport(point)) return true;
        const source = this.hitSource(point);
        const formationId = this.hitFormation(point);
        this.touch = { id, start: point, last: point, mode: 'pending', heldSeconds: 0, source,
            formationId: formationId ?? undefined };
        return true;
    }

    touchMove(id: number, screenPoint: Vector2Data): void {
        const touch = this.touch; if (!touch || touch.id !== id) return;
        const point = this.local(screenPoint);
        if (touch.mode === 'pending' && this.distance(point, touch.start) > lineupInteraction.moveTolerance) {
            touch.mode = 'scroll'; touch.source = undefined; touch.formationId = undefined;
            this.setScroll(this.scrollOffset + point.y - touch.start.y);
        } else if (touch.mode === 'scroll') {
            this.setScroll(this.scrollOffset + point.y - touch.last.y);
        } else if (touch.mode === 'drag') {
            this.placeGhost(point); this.showTarget(this.hitSlot(point));
        }
        touch.last = point;
    }

    /** 由 Boot 提供帧时长，长按不读取系统时间，自动滚动与帧率无关。 */
    update(deltaSeconds: number): void {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
        const touch = this.touch; if (!touch || this.info.isOpen) return;
        if (touch.mode === 'pending' && touch.source) {
            touch.heldSeconds += deltaSeconds;
            if (touch.heldSeconds >= lineupInteraction.holdSeconds) {
                touch.mode = 'drag';
                this.ghost = this.playerCard(this.root, touch.source.templateId, true);
                this.placeGhost(touch.last); this.showTarget(this.hitSlot(touch.last));
            }
        }
        if (touch.mode !== 'drag') return;
        const { viewportTop, viewportBottom, edgeSize, maxEdgeSpeed } = lineupInteraction;
        const point = touch.last;
        if (Math.abs(point.x) > lineupInteraction.viewportWidth / 2) return;
        const top = Math.max(0, Math.min(1, (point.y - (viewportTop - edgeSize)) / edgeSize));
        const bottom = Math.max(0, Math.min(1, (viewportBottom + edgeSize - point.y) / edgeSize));
        // 卡顿单帧限位，避免拖动时内容突然跳过目标。
        this.setScroll(this.scrollOffset + (bottom - top) * maxEdgeSpeed * Math.min(deltaSeconds, 0.05));
        this.showTarget(this.hitSlot(point));
    }

    touchEnd(id: number, screenPoint: Vector2Data): void {
        const touch = this.touch; if (!touch || touch.id !== id) return;
        const point = this.local(screenPoint);
        this.clearGesture(); // 提交前释放手势，setDraft 重建节点不会遗留拖动状态。
        const shortTap = this.distance(point, touch.start) <= lineupInteraction.moveTolerance;
        if (touch.mode === 'modal') {
            if (shortTap && touch.close && this.info.hitClose(point)) this.info.close();
            return;
        }
        if (touch.mode === 'button' && shortTap) {
            this.submit({ type: touch.button === 'back' ? 'BackToBlue' : 'ConfirmSide' }); return;
        }
        if (touch.mode === 'pending' && shortTap) {
            if (touch.source) this.info.show(touch.source.templateId);
            else if (touch.formationId) this.submit({ type: 'SelectFormation', formationId: touch.formationId });
            return;
        }
        if (touch.mode !== 'drag' || !touch.source) return;
        const slot = this.hitSlot(point); if (slot === null) return;
        if (touch.source.kind === 'bench') this.submit({ type: 'ReplaceFromBench',
            templateId: touch.source.templateId, slot });
        else if (slot !== touch.source.slot) this.submit({ type: 'SwapSlots', from: touch.source.slot, to: slot });
    }

    touchCancel(id?: number): void {
        if (id !== undefined && this.touch?.id !== id) return;
        this.clearGesture();
    }
    private distance(a: Vector2Data, b: Vector2Data): number { return Math.hypot(a.x - b.x, a.y - b.y); }
    private clearGesture(): void {
        this.touch = undefined; this.showTarget(null);
        this.ghost?.destroy(); this.ghost = undefined;
    }
    private setScroll(offset: number): void {
        this.scrollOffset = Math.max(0, Math.min(this.maxScroll(), offset));
        this.content.setPosition(0, -viewportCenterY + this.scrollOffset);
    }
    private maxScroll(): number {
        const rows = Math.ceil(this.benchCards.length / lineupInteraction.benchColumns);
        const bottom = rows > 0 ? lineupInteraction.benchFirstY - (rows - 1) * lineupInteraction.rowStep
            - lineupInteraction.benchCardHeight / 2 - 12 : -280;
        return Math.max(0, lineupInteraction.viewportBottom - bottom);
    }
    private insideViewport(point: Vector2Data): boolean {
        return Math.abs(point.x) <= lineupInteraction.viewportWidth / 2
            && point.y >= lineupInteraction.viewportBottom && point.y <= lineupInteraction.viewportTop;
    }
    private hitSlot(point: Vector2Data): number | null {
        if (!this.insideViewport(point)) return null;
        const y = point.y - this.scrollOffset;
        const slot = this.slotPoints.findIndex(p => Math.abs(point.x - p.x) <= 60 && Math.abs(y - p.y) <= 56);
        return slot < 0 ? null : slot;
    }
    private hitSource(point: Vector2Data): Source | undefined {
        const slot = this.hitSlot(point);
        if (slot !== null) return { kind: 'slot', slot, templateId: this.snapshot[this.snapshot.side][slot] };
        const y = point.y - this.scrollOffset;
        const index = this.benchCards.findIndex(card => Math.abs(point.x - card.position.x) <= lineupInteraction.benchCardWidth / 2
            && Math.abs(y - card.position.y) <= lineupInteraction.benchCardHeight / 2);
        return index < 0 ? undefined : { kind: 'bench', templateId: this.snapshot.bench[index] };
    }
    private hitFormation(point: Vector2Data): FormationId | null {
        const y = point.y - this.scrollOffset;
        return this.formationButtons.find(item => Math.abs(point.x - item.node.position.x) <= 90
            && Math.abs(y - item.node.position.y) <= 25)?.id ?? null;
    }
    private placeGhost(point: Vector2Data): void {
        this.ghost?.setPosition(point.x, point.y);
        this.ghost?.setSiblingIndex(this.root.children.length - 1);
    }
    private showTarget(slot: number | null): void {
        this.targetRing.clear();
        if (slot === null || (this.touch?.source?.kind === 'slot' && this.touch.source.slot === slot)) return;
        this.targetRing.strokeColor = new Color(255, 219, 113); this.targetRing.lineWidth = 6;
        this.targetRing.roundRect(this.slotPoints[slot].x - 63, this.slotPoints[slot].y - 59, 126, 118, 18);
        this.targetRing.stroke();
    }
    private local(point: Vector2Data): Vector2Data {
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.root.getComponent(UITransform)!.convertToNodeSpaceAR(world);
        return { x: local.x, y: local.y };
    }
    private drawPitch(): void {
        this.panel(this.content, 'PitchFrame', 660, 600, 0, 96, new Color(18, 57, 52), 24);
        const pitch = this.panel(this.content, 'Pitch', 620, 560, 0, 96, new Color(34, 124, 82), 12);
        const art = pitch.getComponent(Graphics)!;
        art.fillColor = new Color(28, 106, 74);
        for (let i = 0; i < 8; i += 2) { art.rect(-300, -270 + i * 67.5, 600, 67.5); art.fill(); }
        art.strokeColor = new Color(193, 239, 206, 160); art.lineWidth = 3;
        art.rect(-300, -270, 600, 540); art.rect(-125, -270, 250, 70); art.stroke();
        art.moveTo(-300, 270); art.lineTo(300, 270); art.stroke();
        this.label(this.content, '↑ 进攻方向', 0, 377, 18, 250);
        this.label(this.content, '己方球门', 0, -168, 16, 250);
    }
    private playerCard(parent: Node, id: string, field: boolean): Node {
        const template = getPlayerTemplate(this.catalog, id); const frame = this.portraits.get(id);
        const width = field ? 120 : lineupInteraction.benchCardWidth;
        const height = field ? 108 : lineupInteraction.benchCardHeight;
        const card = this.panel(parent, 'Card-' + id, width, height, 0, 0,
            field ? new Color(11, 42, 54, 240) : new Color(29, 42, 59), 18);
        const [r, green, b] = playerRarityPresentation(template.rarity).rgb;
        const rarity = new Color(r, green, b);
        const g = card.getComponent(Graphics)!; g.strokeColor = rarity;
        g.lineWidth = field ? 4 : 2.5; g.stroke();
        if (!field) this.panel(card, 'TierAccent', 72, 4, 0, 68, rarity, 2);
        const size = field ? 68 : 86;
        const avatar = this.node(card, 'Avatar', size, size); avatar.setPosition(0, field ? 15 : 13);
        if (frame) {
            const mask = avatar.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
            const image = this.node(avatar, 'Image', size, size);
            const sprite = image.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM; sprite.spriteFrame = frame;
        } else {
            const art = avatar.addComponent(Graphics); art.fillColor = new Color(24, 91, 104);
            art.circle(0, 0, size / 2); art.fill();
            this.label(avatar, template.name, 0, 0, template.name.length > 4 ? 13 : 16, size - 8);
        }
        const name = this.label(card, template.name, 0, field ? -34 : -49, 18, field ? 114 : 136,
            new Color(240, 244, 248));
        name.overflow = Label.Overflow.SHRINK;
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
    private label(parent: Node, text: string, x: number, y: number, size: number, width: number,
        color = new Color(233, 247, 246)): Label {
        const node = this.node(parent, 'Text', width, size + 16); node.setPosition(x, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size;
        label.lineHeight = size + 4; label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER; label.color = color;
        return label;
    }
    dispose(): void { this.clearGesture(); this.info.dispose(); if (isValid(this.root, true)) this.root.destroy(); }
}
