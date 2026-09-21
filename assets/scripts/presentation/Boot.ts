import { _decorator, Component, EventTouch, input, Input, game, Game, view, ResolutionPolicy,
    Label, Node, UITransform } from 'cc';
import { LocalMatch } from '../application/LocalMatch';
import { createPrototypeState, freezeConfig, prototypeConfig, PrototypeConfig, Fixture } from '../core/PrototypeConfig';
import { LaunchGesture } from '../core/LaunchGesture';
import { CocosPhysics } from '../adapters/physics/CocosPhysics';
import { PrototypeView } from './PrototypeView';

const { ccclass } = _decorator;
let sessionSequence = 0;

/** 组合应用、输入与视图；比分和阶段只由 LocalMatch 写入。 */
@ccclass('Boot')
export class Boot extends Component {
    private config!: PrototypeConfig;
    private match?: LocalMatch;
    private physics?: CocosPhysics;
    private screen?: PrototypeView;
    private gesture?: LaunchGesture;
    private fixture: Fixture = 'normal';
    private commandSequence = 0;
    private paused = false;
    private background = false;
    private skipFrame = true;
    private listening = false;
    private message = '';

    start(): void {
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        try {
            this.config = freezeConfig(prototypeConfig);
            this.gesture = new LaunchGesture(this.config);
            this.screen = new PrototypeView(this.node, this.config, () => {
                if (!this.gesture?.preview()) this.reset();
            }, () => {
                if (this.gesture?.preview()) return;
                const fixtures: readonly Fixture[] = ['normal', 'dense', 'wall', 'corner'];
                this.fixture = fixtures[(fixtures.indexOf(this.fixture) + 1) % fixtures.length]; this.reset();
            });
            this.reset(); this.listen();
        } catch (error) {
            this.physics?.dispose(); this.physics = undefined; this.screen?.dispose(); this.screen = undefined;
            const node = new Node('StartupError'); node.layer = this.node.layer; this.node.addChild(node);
            node.addComponent(UITransform).setContentSize(650, 300);
            const label = node.addComponent(Label); label.fontSize = 24;
            label.string = `原型启动失败\n${String(error)}\n请检查配置或 Box2D 模块后重新运行`; label.enableWrapText = true;
            console.error(error);
        }
    }
    private reset(): void {
        this.gesture?.cancel(); this.physics?.dispose(); this.physics = undefined;
        // 会话 ID 来自组合层，规则核心不读取真实系统时间。
        const state = createPrototypeState(`practice-${Date.now()}-${++sessionSequence}`, this.config, this.fixture);
        this.physics = new CocosPhysics(this.node.scene!, this.config, state);
        this.match = new LocalMatch(state, this.physics, this.config);
        this.message = ''; this.skipFrame = true; this.draw();
    }
    private readonly beginTouch = (event: EventTouch): void => {
        const id = event.getID(); if (id === null) return;
        if (this.background || !this.enabledInHierarchy || !this.match || !this.screen) return;
        // 编辑器嵌入预览失焦后不一定先收到 window.focus；真实触摸本身即可恢复前台输入。
        // 同一个 TOUCH_START 继续用于选人，不能让用户的第一次拖动只负责解除暂停。
        if (this.paused) this.resume();
        const state = this.match.getSnapshot(); if (state.phase !== 'Aiming') return;
        const point = this.screen.toField(event.getLocation());
        const player = state.players.find(p => p.ownerId === state.activeOperatorId
            && Math.hypot(p.position.x - point.x, p.position.y - point.y) <= this.config.playerRadius);
        if (player) this.gesture!.begin(id, player.instanceId, point);
    };
    private readonly moveTouch = (event: EventTouch): void => {
        const id = event.getID(); if (id === null) return;
        if (this.screen) this.gesture?.move(id, this.screen.toField(event.getLocation()));
    };
    private readonly endTouch = (event: EventTouch): void => {
        const id = event.getID(); if (id === null) return;
        if (this.paused || !this.screen || !this.match) return;
        const launch = this.gesture?.end(id, this.screen.toField(event.getLocation()));
        if (!launch?.aim) return;
        const state = this.match.getSnapshot();
        const result = this.match.execute({ type: 'Launch', commandId: `${state.matchId}-${++this.commandSequence}`,
            matchId: state.matchId, turnNumber: state.turnNumber, operatorId: 'a', playerId: launch.playerId,
            ...launch.aim }, 'a');
        this.message = result.ok ? '' : `操作被拒绝：${result.reason}`;
    };
    private readonly cancelTouch = (event: EventTouch): void => {
        const id = event.getID(); if (id !== null) this.gesture?.cancel(id);
    };
    private readonly pause = (): void => {
        this.paused = true; this.gesture?.cancel(); this.match?.discardAccumulatedTime();
        this.draw();
    };
    private readonly resume = (): void => {
        if (this.background) return;
        this.paused = false; this.skipFrame = true;
    };
    private readonly hide = (): void => { this.background = true; this.pause(); };
    private readonly show = (): void => { this.background = false; this.resume(); };
    private listen(): void {
        if (this.listening) return; this.listening = true;
        input.on(Input.EventType.TOUCH_START, this.beginTouch, this);
        input.on(Input.EventType.TOUCH_MOVE, this.moveTouch, this);
        input.on(Input.EventType.TOUCH_END, this.endTouch, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.cancelTouch, this);
        game.on(Game.EVENT_HIDE, this.hide, this); game.on(Game.EVENT_SHOW, this.show, this);
        if (typeof window !== 'undefined') {
            window.addEventListener('blur', this.pause); window.addEventListener('focus', this.resume);
        }
    }
    onEnable(): void { if (this.match) { this.resume(); this.listen(); } }
    onDisable(): void {
        this.pause(); this.listening = false;
        input.off(Input.EventType.TOUCH_START, this.beginTouch, this);
        input.off(Input.EventType.TOUCH_MOVE, this.moveTouch, this);
        input.off(Input.EventType.TOUCH_END, this.endTouch, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.cancelTouch, this);
        game.off(Game.EVENT_HIDE, this.hide, this); game.off(Game.EVENT_SHOW, this.show, this);
        if (typeof window !== 'undefined') {
            window.removeEventListener('blur', this.pause); window.removeEventListener('focus', this.resume);
        }
    }
    update(deltaSeconds: number): void {
        if (this.paused) return;
        if (this.skipFrame) this.skipFrame = false; else this.match?.advance(deltaSeconds);
        this.draw();
    }
    private draw(): void {
        if (!this.match || !this.screen) return;
        const state = this.match.getSnapshot(); const status = this.match.getSimulationStatus();
        const gesture = this.gesture?.preview() ?? null;
        const reasons = { ready: '拖动蓝色球员开始', moving: '运动中，请等待停止', stopped: '已停止，可以再次拖动',
            timeout: '运动超时，已强制停止，可再次操作', invalid: '物理状态异常，已恢复发射前摆位' };
        const title = this.paused ? '已暂停，回到画面按住蓝球继续'
            : gesture ? `力度 ${Math.round((gesture.aim?.power ?? 0) * 100)}% · 松手发射` : reasons[status.reason];
        const fixtureNames: Record<Fixture, string> = { normal: '普通', dense: '密集', wall: '贴墙', corner: '角落' };
        this.screen.render(state, gesture, this.message || title,
            `${fixtureNames[this.fixture]}摆位 · 第 ${state.turnNumber} 次操作 · 模拟 ${status.seconds.toFixed(2)} 秒\n`
            + `蓝色：己方　红色：对方　白色：皮球${status.droppedSeconds > 0.01 ? ' · 卡顿已限步' : ''}`);
    }
    onDestroy(): void { this.physics?.dispose(); this.screen?.dispose(); }
}
