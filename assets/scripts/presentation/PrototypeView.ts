import { Node, UITransform, Graphics, Color, Label, Vec3, isValid, Canvas, Camera,
    Mask, Sprite, SpriteFrame } from 'cc';
import type { GameState, Vector2Data } from '../core/GameState';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import type { LaunchGesture } from '../core/LaunchGesture';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import { getPlayerTemplate, playerGameplayValues } from '../core/PlayerCatalog';
import type { MatchOverlay, MatchSide } from './MatchFeedback';
import { matchClock, sideLabel } from './MatchFeedback';

const pixelsPerMeter = 80;
/** 位置读取权威状态；本地皮球图案角度读取物理刚体。物理节点不挂在本视图下。 */
export class PrototypeView {
    readonly root: Node;
    private readonly field: UITransform;
    private readonly camera: Camera;
    private readonly bodies: Graphics;
    private readonly portraitLayer: Node;
    private readonly portraitNodes = new Map<string, { node: Node; templateId: string }>();
    private readonly powerCircle: Graphics;
    private readonly aim: Graphics;
    private readonly status: Label;
    private readonly info: Label;
    private readonly score: Label;
    private readonly clock: Label;
    private readonly activeRestartButton: Node;
    private readonly eventPanel: Node;
    private readonly eventTitle: Label;
    private readonly eventDetail: Label;
    private readonly resultPanel: Node;
    private readonly resultTitle: Label;
    private readonly resultScore: Label;

    constructor(parent: Node, private readonly config: PrototypeConfig, restart: () => void,
        editLineups: () => void,
        private readonly catalog?: PlayerCatalog, private readonly portraitFrames?: ReadonlyMap<string, SpriteFrame>) {
        const camera = parent.getComponent(Canvas)?.cameraComponent;
        if (!camera) throw new Error('球场视图需要 Canvas 的渲染相机');
        this.camera = camera;
        this.root = this.node(parent, 'Match', 720, 1280);
        this.label(this.root, '足球弹弹乐 · 本地双人', 603, 30);
        this.label(this.root, '拖动当前行动方球员，向相反方向发射', 563, 19);
        const hud = this.panel(this.root, 'MatchHud', 640, 104, 0, 492, new Color(15, 31, 45, 225), 20);
        this.score = this.label(hud, '', 22, 29);
        this.clock = this.label(hud, '', -22, 21);
        const field = this.node(this.root, 'Field', config.fieldWidth * pixelsPerMeter, config.fieldHeight * pixelsPerMeter);
        this.field = field.getComponent(UITransform)!;
        const g = field.addComponent(Graphics);
        const w = config.fieldWidth * pixelsPerMeter; const h = config.fieldHeight * pixelsPerMeter;
        this.drawGrass(g, w, h);
        g.strokeColor = new Color(234, 244, 223, 232); g.lineWidth = 3;
        const goalWidth = config.goalWidth * pixelsPerMeter;
        const goalDepth = config.goalDepth * pixelsPerMeter;
        g.rect(-goalWidth / 2, h / 2, goalWidth, goalDepth);
        g.rect(-goalWidth / 2, -h / 2 - goalDepth, goalWidth, goalDepth);
        g.moveTo(-w / 2, -h / 2); g.lineTo(-w / 2, h / 2); g.lineTo(-goalWidth / 2, h / 2);
        g.moveTo(goalWidth / 2, h / 2); g.lineTo(w / 2, h / 2); g.lineTo(w / 2, -h / 2);
        g.lineTo(goalWidth / 2, -h / 2); g.moveTo(-goalWidth / 2, -h / 2); g.lineTo(-w / 2, -h / 2);
        g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke();
        g.circle(0, 0, 72); g.stroke();
        g.rect(-120, -h / 2, 240, 115); g.rect(-120, h / 2 - 115, 240, 115); g.stroke();
        this.powerCircle = this.node(field, 'PowerCircle', w, h).addComponent(Graphics);
        this.bodies = this.node(field, 'Bodies', w, h).addComponent(Graphics);
        this.portraitLayer = this.node(field, 'Portraits', w, h);
        this.aim = this.node(field, 'Aim', w, h).addComponent(Graphics);
        this.status = this.label(this.root, '', 431, 21);
        this.info = this.label(this.root, '', -478, 19);
        this.activeRestartButton = this.button(this.root, '重新开始', 0, -550, restart, 250);

        this.eventPanel = this.panel(this.root, 'EventFeedback', 520, 174, 0, 20,
            new Color(18, 30, 39, 238), 22);
        this.eventTitle = this.label(this.eventPanel, '', 28, 40);
        this.eventDetail = this.label(this.eventPanel, '', -30, 25);
        this.eventPanel.active = false;

        this.resultPanel = this.panel(this.root, 'MatchResult', 590, 370, 0, 12,
            new Color(10, 23, 34, 248), 26);
        this.resultTitle = this.label(this.resultPanel, '', 105, 42);
        this.resultScore = this.label(this.resultPanel, '', 40, 31);
        this.label(this.resultPanel, '比赛时间结束', -14, 20).color = new Color(177, 194, 202);
        this.button(this.resultPanel, '再来一局', -137, -112, restart, 240);
        this.button(this.resultPanel, '调整阵容', 137, -112, editLineups, 240);
        this.resultPanel.active = false;
        this.label(this.root, `${config.version} · 标准模式 3 分钟 · 每队 5 人`, -612, 17);
    }
    private drawGrass(g: Graphics, width: number, height: number): void {
        // 横向修剪条纹和细草纹只绘制一次；固定种子避免每次重开时草地外观跳变。
        const bands = 12;
        const bandHeight = height / bands;
        for (let index = 0; index < bands; index++) {
            const y = -height / 2 + index * bandHeight;
            g.fillColor = index % 2 === 0 ? new Color(42, 132, 73) : new Color(34, 111, 62);
            g.rect(-width / 2, y, width, bandHeight); g.fill();
            // 条纹内部的微弱亮度变化，让色带看起来像顺逆向压平的草叶。
            g.fillColor = new Color(145, 200, 119, 11);
            g.rect(-width / 2, y + bandHeight * 0.16, width, bandHeight * 0.22); g.fill();
        }

        let seed = 0x6d2b79f5;
        const random = (): number => {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            return (seed >>> 0) / 0x100000000;
        };
        // 细短笔触作为草叶颗粒，按颜色合批；全部限制在球场矩形以内。
        for (const color of [new Color(167, 216, 133, 35), new Color(8, 55, 33, 37)]) {
            g.fillColor = color;
            for (let index = 0; index < 1500; index++) {
                const x = -width / 2 + random() * (width - 2);
                const y = -height / 2 + random() * (height - 6);
                g.rect(x, y, 0.7 + random() * 0.9, 1.5 + random() * 4.5);
            }
            g.fill();
        }

        g.fillColor = new Color(5, 39, 27, 48);
        g.rect(-width / 2, -height / 2, 12, height);
        g.rect(width / 2 - 12, -height / 2, 12, height);
        g.rect(-width / 2, -height / 2, width, 10);
        g.rect(-width / 2, height / 2 - 10, width, 10);
        g.fill();
    }
    private node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); return node;
    }
    private panel(parent: Node, name: string, width: number, height: number, x: number, y: number,
        color: Color, radius: number): Node {
        const node = this.node(parent, name, width, height); node.setPosition(x, y);
        const graphics = node.addComponent(Graphics); graphics.fillColor = color;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius); graphics.fill();
        return node;
    }
    private label(parent: Node, text: string, y: number, size: number): Label {
        const node = this.node(parent, 'Text', 690, 90); node.setPosition(0, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size;
        label.lineHeight = size + 8; label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER; label.color = new Color(235, 244, 242);
        return label;
    }
    private button(parent: Node, text: string, x: number, y: number, action: () => void, width: number): Node {
        const node = this.node(parent, text, width, 62); node.setPosition(x, y);
        const g = node.addComponent(Graphics); g.fillColor = new Color(45, 69, 94);
        g.roundRect(-width / 2, -31, width, 62, 12); g.fill();
        const label = this.label(node, text, 0, 22); label.node.getComponent(UITransform)!.setContentSize(width, 62);
        node.on(Node.EventType.TOUCH_END, action);
        return node;
    }
    /** 只在创建或更换阵容时调整节点；逐帧渲染只更新位置。 */
    setPlayers(state: GameState): void {
        if (!this.catalog || !this.portraitFrames) return;
        for (const [id, item] of this.portraitNodes) {
            const player = state.players.find(entry => entry.instanceId === id);
            if (!player || player.templateId !== item.templateId) {
                item.node.destroy(); this.portraitNodes.delete(id);
            }
        }
        const diameter = this.config.playerRadius * 2 * pixelsPerMeter - 8;
        for (const player of state.players) {
            if (this.portraitNodes.has(player.instanceId)) continue;
            const template = getPlayerTemplate(this.catalog, player.templateId);
            const frame = this.portraitFrames.get(template.id);
            if (!frame) throw new Error(`缺少头像资源：${template.id}`);
            const node = this.node(this.portraitLayer, player.instanceId, diameter, diameter);
            const mask = node.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE; mask.segments = 32;
            const imageNode = this.node(node, 'Image', diameter, diameter);
            const sprite = imageNode.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.spriteFrame = frame;
            this.portraitNodes.set(player.instanceId, { node, templateId: player.templateId });
        }
    }
    toField(point: Vector2Data): Vector2Data {
        // 与 Cocos UI 命中检测保持一致：屏幕 → 实际渲染相机 → 球场局部坐标。
        // getUILocation 仅按 view 缩放换算，不能代替带相机/预览视口的世界坐标转换。
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.field.convertToNodeSpaceAR(world);
        return { x: local.x / pixelsPerMeter, y: local.y / pixelsPerMeter };
    }
    render(state: GameState, gesture: ReturnType<LaunchGesture['preview']>, status: string, info: string,
        ballAngle = 0, feedback: MatchOverlay | null = null): void {
        const g = this.bodies; g.clear();
        for (const player of state.players) {
            g.fillColor = player.ownerId === 'blue' ? new Color(68, 167, 255) : new Color(245, 105, 102);
            g.circle(player.position.x * pixelsPerMeter, player.position.y * pixelsPerMeter, this.config.playerRadius * pixelsPerMeter); g.fill();
            g.strokeColor = player.ownerId === state.activeOperatorId ? new Color(255, 220, 90) : Color.WHITE;
            g.lineWidth = player.ownerId === state.activeOperatorId ? 4 : 2; g.stroke();
            this.portraitNodes?.get(player.instanceId)?.node.setPosition(
                player.position.x * pixelsPerMeter, player.position.y * pixelsPerMeter);
        }
        this.drawBall(g, state.ball.position.x * pixelsPerMeter, state.ball.position.y * pixelsPerMeter,
            this.config.ballRadius * pixelsPerMeter, ballAngle);
        const a = this.aim; a.clear();
        const powerCircle = this.powerCircle; powerCircle.clear();
        if (gesture) {
            const player = state.players.find(p => p.instanceId === gesture.playerId)!;
            const x = player.position.x * pixelsPerMeter; const y = player.position.y * pixelsPerMeter;
            const power = Math.max(0, Math.min(1, gesture.aim?.power ?? 0));
            const radius = this.config.playerRadius + (this.config.powerCircleMaxRadius - this.config.playerRadius) * power;
            powerCircle.fillColor = new Color(255, 205, 135, Math.round(255 * this.config.powerCircleOpacity));
            powerCircle.circle(x, y, radius * pixelsPerMeter); powerCircle.fill();
        }
        if (gesture?.aim) {
            const player = state.players.find(p => p.instanceId === gesture.playerId)!;
            const { direction } = gesture.aim;
            const x = player.position.x * pixelsPerMeter; const y = player.position.y * pixelsPerMeter;
            // 精度决定可见瞄准长度；力度只影响发射冲量和百分比提示。
            const length = (this.catalog
                ? playerGameplayValues(getPlayerTemplate(this.catalog, player.templateId), this.config).aimLength
                : this.config.aimLength) * pixelsPerMeter;
            const ex = x + direction.x * length; const ey = y + direction.y * length;
            a.strokeColor = Color.WHITE; a.lineWidth = 3;
            const dash = this.config.aimDashLength * pixelsPerMeter;
            const spacing = (this.config.aimDashLength + this.config.aimDashGap) * pixelsPerMeter;
            for (let offset = 0; offset < length; offset += spacing) {
                const end = Math.min(offset + dash, length);
                a.moveTo(x + direction.x * offset, y + direction.y * offset);
                a.lineTo(x + direction.x * end, y + direction.y * end);
            }
            a.moveTo(ex - direction.x * 12 + direction.y * 7, ey - direction.y * 12 - direction.x * 7);
            a.lineTo(ex, ey); a.lineTo(ex - direction.x * 12 - direction.y * 7, ey - direction.y * 12 + direction.x * 7); a.stroke();
        }
        const activeSide = state.activeOperatorId as MatchSide;
        const turnSeconds = Math.max(0, Math.ceil(state.clock.turnRemainingMs / 1000));
        const warning = state.phase === 'Aiming' && turnSeconds <= 5;
        this.score.string = `蓝  ${state.score.blue ?? 0}  :  ${state.score.red ?? 0}  红`;
        this.clock.string = `比赛 ${matchClock(state.clock.remainingMs)}`
            + (state.phase === 'Aiming' ? `　·　回合 ${turnSeconds} 秒` : '　·　运动中');
        this.clock.color = warning ? new Color(255, 115, 92) : new Color(210, 226, 231);
        this.status.string = status;
        this.status.color = warning ? new Color(255, 164, 80)
            : activeSide === 'blue' ? new Color(115, 196, 255) : new Color(255, 143, 139);
        this.info.string = info;
        const finished = state.phase === 'Finished';
        this.activeRestartButton.active = !finished;
        this.resultPanel.active = finished;
        if (finished) {
            const winner = state.result?.winnerId as MatchSide | null | undefined;
            this.resultTitle.string = winner === null ? '本场平局' : winner ? `${sideLabel(winner)}获胜` : '比赛结束';
            this.resultTitle.color = winner === 'blue' ? new Color(105, 190, 255)
                : winner === 'red' ? new Color(255, 129, 126) : new Color(255, 218, 112);
            this.resultScore.string = `最终比分　蓝 ${state.score.blue ?? 0} : ${state.score.red ?? 0} 红`;
        }
        this.eventPanel.active = !finished && feedback !== null;
        if (feedback && !finished) {
            this.eventTitle.string = feedback.title;
            this.eventTitle.color = feedback.type === 'goal' ? new Color(255, 219, 91) : new Color(255, 157, 91);
            this.eventDetail.string = feedback.detail;
        }
    }
    private drawBall(g: Graphics, x: number, y: number, radius: number, angleDegrees: number): void {
        g.fillColor = Color.WHITE; g.circle(x, y, radius); g.fill();
        g.strokeColor = new Color(28, 31, 35); g.lineWidth = Math.max(1, radius * 0.1);
        g.circle(x, y, radius); g.stroke();
        const angle = angleDegrees * Math.PI / 180;
        const polygon = (cx: number, cy: number, size: number, rotation: number): void => {
            for (let vertex = 0; vertex <= 5; vertex++) {
                const theta = rotation + (vertex % 5) * Math.PI * 2 / 5;
                const px = cx + Math.cos(theta) * size; const py = cy + Math.sin(theta) * size;
                if (vertex === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.fill();
        };
        g.fillColor = new Color(25, 28, 32);
        polygon(x, y, radius * 0.36, angle - Math.PI / 2);
        for (let panel = 0; panel < 5; panel++) {
            const direction = angle - Math.PI / 2 + panel * Math.PI * 2 / 5;
            // 一块近处黑面稍大，模拟球面透视并打破五重重复，避免快转时看起来突然反向。
            const distance = panel === 0 ? 0.66 : 0.73;
            const size = panel === 0 ? 0.32 : 0.23;
            polygon(x + Math.cos(direction) * radius * distance,
                y + Math.sin(direction) * radius * distance, radius * size, direction);
            g.moveTo(x + Math.cos(direction) * radius * 0.36, y + Math.sin(direction) * radius * 0.36);
            g.lineTo(x + Math.cos(direction) * radius * 0.5, y + Math.sin(direction) * radius * 0.5);
            g.stroke();
        }
    }
    dispose(): void { if (isValid(this.root, true)) this.root.destroy(); }
}
