import { Node, UITransform, Graphics, Color, Label, Vec3, isValid, Canvas, Camera } from 'cc';
import type { GameState, Vector2Data } from '../core/GameState';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import type { LaunchGesture } from '../core/LaunchGesture';

const pixelsPerMeter = 80;
/** 仅画权威状态；物理节点不挂在本视图下。 */
export class PrototypeView {
    readonly root: Node;
    private readonly field: UITransform;
    private readonly camera: Camera;
    private readonly bodies: Graphics;
    private readonly powerCircle: Graphics;
    private readonly aim: Graphics;
    private readonly status: Label;
    private readonly info: Label;

    constructor(parent: Node, private readonly config: PrototypeConfig, restart: () => void) {
        const camera = parent.getComponent(Canvas)?.cameraComponent;
        if (!camera) throw new Error('球场视图需要 Canvas 的渲染相机');
        this.camera = camera;
        this.root = this.node(parent, 'Match', 720, 1280);
        this.label(this.root, '足球弹弹乐 · 本地双人', 575, 30);
        this.label(this.root, '轮到哪一方，就拖动该方球员反向发射', 532, 21);
        const field = this.node(this.root, 'Field', config.fieldWidth * pixelsPerMeter, config.fieldHeight * pixelsPerMeter);
        this.field = field.getComponent(UITransform)!;
        const g = field.addComponent(Graphics);
        const w = config.fieldWidth * pixelsPerMeter; const h = config.fieldHeight * pixelsPerMeter;
        g.fillColor = new Color(24, 85, 62); g.rect(-w / 2, -h / 2, w, h); g.fill();
        g.strokeColor = new Color(180, 219, 190); g.lineWidth = 3;
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
        this.aim = this.node(field, 'Aim', w, h).addComponent(Graphics);
        this.status = this.label(this.root, '', 470, 22);
        this.info = this.label(this.root, '', -473, 20);
        this.button('重新开始', 0, restart);
        this.label(this.root, `${config.version} · 标准模式 3 分钟 · 每队 5 人`, -612, 17);
    }
    private node(parent: Node, name: string, width: number, height: number): Node {
        const node = new Node(name); node.layer = parent.layer; parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height); return node;
    }
    private label(parent: Node, text: string, y: number, size: number): Label {
        const node = this.node(parent, 'Text', 690, 90); node.setPosition(0, y);
        const label = node.addComponent(Label); label.string = text; label.fontSize = size;
        label.lineHeight = size + 8; label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER; label.color = new Color(235, 244, 242);
        return label;
    }
    private button(text: string, x: number, action: () => void): void {
        const node = this.node(this.root, text, 270, 62); node.setPosition(x, -555);
        const g = node.addComponent(Graphics); g.fillColor = new Color(45, 69, 94);
        g.roundRect(-135, -31, 270, 62, 12); g.fill();
        const label = this.label(node, text, 0, 22); label.node.getComponent(UITransform)!.setContentSize(270, 62);
        node.on(Node.EventType.TOUCH_END, action);
    }
    toField(point: Vector2Data): Vector2Data {
        // 与 Cocos UI 命中检测保持一致：屏幕 → 实际渲染相机 → 球场局部坐标。
        // getUILocation 仅按 view 缩放换算，不能代替带相机/预览视口的世界坐标转换。
        const world = this.camera.screenToWorld(new Vec3(point.x, point.y, 0));
        const local = this.field.convertToNodeSpaceAR(world);
        return { x: local.x / pixelsPerMeter, y: local.y / pixelsPerMeter };
    }
    render(state: GameState, gesture: ReturnType<LaunchGesture['preview']>, status: string, info: string): void {
        const g = this.bodies; g.clear();
        for (const player of state.players) {
            g.fillColor = player.ownerId === 'blue' ? new Color(68, 167, 255) : new Color(245, 105, 102);
            g.circle(player.position.x * pixelsPerMeter, player.position.y * pixelsPerMeter, this.config.playerRadius * pixelsPerMeter); g.fill();
            g.strokeColor = player.ownerId === state.activeOperatorId ? new Color(255, 220, 90) : Color.WHITE;
            g.lineWidth = player.ownerId === state.activeOperatorId ? 4 : 2; g.stroke();
        }
        g.fillColor = Color.WHITE; g.circle(state.ball.position.x * pixelsPerMeter, state.ball.position.y * pixelsPerMeter,
            this.config.ballRadius * pixelsPerMeter); g.fill();
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
            const length = this.config.aimLength * pixelsPerMeter;
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
        this.status.string = status; this.info.string = info;
    }
    dispose(): void { if (isValid(this.root, true)) this.root.destroy(); }
}
