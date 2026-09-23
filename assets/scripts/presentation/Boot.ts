import { _decorator, Component, EventTouch, input, Input, game, Game, view, ResolutionPolicy,
    Label, Node, UITransform } from 'cc';
import { LocalMatch } from '../application/LocalMatch';
import { createStandardMatchState, freezeConfig, prototypeConfig, PrototypeConfig } from '../core/PrototypeConfig';
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
        const sequence = ++sessionSequence;
        const seed = (Date.now() ^ Math.imul(sequence, 0x9e3779b9)) >>> 0;
        const state = createStandardMatchState(`local-${Date.now()}-${sequence}`, this.config, seed);
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
        const operatorId = state.activeOperatorId;
        const result = this.match.execute({ type: 'Launch', commandId: `${state.matchId}-${++this.commandSequence}`,
            matchId: state.matchId, turnNumber: state.turnNumber, operatorId, playerId: launch.playerId,
            ...launch.aim }, operatorId);
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
        let gesture = this.gesture?.preview() ?? null;
        const selected = gesture && state.players.find(player => player.instanceId === gesture!.playerId);
        if (gesture && (state.phase !== 'Aiming' || selected?.ownerId !== state.activeOperatorId)) {
            this.gesture?.cancel(); gesture = null;
        }
        const side = state.activeOperatorId === 'blue' ? '蓝方' : '红方';
        const reasons = { ready: `${side}行动`, moving: '运动中，请等待停止', stopped: `${side}行动`,
            timeout: `运动超时，${side}行动`, invalid: `物理状态异常，${side}行动`,
            goal: `进球！${side}开球`, 'turn-timeout': `瞄准超时，${side}行动`, finished: '比赛结束' };
        const result = state.result?.winnerId === null ? '平局'
            : state.result?.winnerId === 'blue' ? '蓝方获胜' : state.result ? '红方获胜' : '';
        const title = this.paused ? '已暂停，回到画面继续'
            : state.phase === 'Finished' ? `比赛结束 · ${result}`
                : gesture ? `力度 ${Math.round((gesture.aim?.power ?? 0) * 100)}% · 松手发射` : reasons[status.reason];
        const seconds = Math.ceil(state.clock.remainingMs / 1000);
        const turnSeconds = Math.ceil(state.clock.turnRemainingMs / 1000);
        const secondPart = seconds % 60;
        const secondText = secondPart < 10 ? `0${secondPart}` : String(secondPart);
        this.screen.render(state, gesture, this.message || title,
            `蓝 ${state.score.blue ?? 0} : ${state.score.red ?? 0} 红　比赛 ${Math.floor(seconds / 60)}:${secondText}`
            + `${state.phase === 'Aiming' ? `　回合 ${turnSeconds} 秒` : ''}\n`
            + `第 ${state.turnNumber} 回合 · 先手 ${state.random.firstOperatorId === 'blue' ? '蓝方' : '红方'}`
            + `${status.droppedSeconds > 0.01 ? ' · 卡顿已限步' : ''}`);
    }
    onDestroy(): void { this.physics?.dispose(); this.screen?.dispose(); }
}
