import type { Command } from '../core/Command';
import type { GameState } from '../core/GameState';
import { validateCommand, Rejection } from '../core/validateCommand';
import type { PhysicsFrame, PhysicsPort } from '../core/PhysicsPort';
import { freezeConfig, PrototypeConfig } from '../core/PrototypeConfig';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export type CommandResult = { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly reason: Rejection };

/** 本地权威入口。初始状态由可信应用配置创建，不能直接传入网络载荷。 */
export class LocalMatch {
    private state: GameState;
    private readonly acceptedIds = new Set<string>();
    private readonly commands: Command[] = [];
    private readonly snapshots: GameState[] = [];
    private readonly config?: PrototypeConfig;
    private beforeLaunch?: GameState;
    private accumulator = 0;
    private steps = 0;
    private quietSteps = 0;
    private droppedSeconds = 0;
    private endReason: 'ready' | 'moving' | 'stopped' | 'timeout' | 'invalid' = 'ready';

    constructor(initialState: GameState, private readonly physics?: PhysicsPort, config?: PrototypeConfig) {
        this.state = copy(initialState);
        if (physics && !config) throw new Error('物理适配器需要配置');
        if (config) this.config = freezeConfig(config);
        physics?.restore(this.state);
        this.recordSnapshot();
    }

    getSnapshot(): GameState { return copy(this.state); }
    getAcceptedCommands(): readonly Command[] { return copy(this.commands); }
    getKeySnapshots(): readonly GameState[] { return copy(this.snapshots); }
    getSimulationStatus() {
        return { reason: this.endReason, seconds: this.steps * (this.config?.fixedStep ?? 0),
            droppedSeconds: this.droppedSeconds };
    }
    /** 生命周期暂停只丢弃积压；正式比赛时钟尚未实现。 */
    discardAccumulatedTime(): void { this.accumulator = 0; }

    advance(deltaSeconds: number): void {
        const config = this.config; const physics = this.physics;
        if (!config || !physics || this.state.phase !== 'Simulating') return;
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
        const cap = config.fixedStep * config.maxSubSteps;
        const pending = this.accumulator + deltaSeconds;
        this.accumulator = Math.min(pending, cap);
        this.droppedSeconds += Math.max(0, pending - cap);
        for (let i = 0; i < config.maxSubSteps && this.accumulator + 1e-10 >= config.fixedStep; i++) {
            this.accumulator = Math.max(0, this.accumulator - config.fixedStep);
            try {
                physics.step(config.fixedStep); this.steps++;
                const frame = physics.sample();
                if (!this.validFrame(frame)) { this.finish('invalid'); break; }
                this.state = { ...this.state, revision: this.state.revision + 1,
                    players: this.state.players.map(player => ({ ...player,
                        ...copy(frame.players.find(p => p.instanceId === player.instanceId)!) })),
                    ball: copy(frame.ball) };
                const quiet = [...frame.players, frame.ball].every(b => Math.hypot(b.velocity.x, b.velocity.y) <= config.stopSpeed);
                this.quietSteps = quiet ? this.quietSteps + 1 : 0;
                if (this.quietSteps >= Math.ceil(config.quietSeconds / config.fixedStep - 1e-9)) {
                    this.finish('stopped'); break;
                }
                if (this.steps >= Math.ceil(config.maxSimulationSeconds / config.fixedStep - 1e-9)) {
                    this.finish('timeout'); break;
                }
            } catch {
                this.finish('invalid'); break;
            }
        }
    }

    private validFrame(frame: PhysicsFrame): boolean {
        const config = this.config!;
        if (frame.players.length !== this.state.players.length
            || new Set(frame.players.map(p => p.instanceId)).size !== frame.players.length
            || !this.state.players.every(p => frame.players.some(b => b.instanceId === p.instanceId))) return false;
        return [...frame.players.map(p => ({ body: p, radius: config.playerRadius })),
            { body: frame.ball, radius: config.ballRadius }].every(({ body, radius }) => {
            const { position: p, velocity: v } = body;
            // 允许 Box2D 接触求解的少量穿入误差；完全越界或非有限值必须恢复。
            return [p.x, p.y, v.x, v.y].every(Number.isFinite)
                && Math.abs(p.x) <= config.fieldWidth / 2 - radius + 0.04
                && Math.abs(p.y) <= config.fieldHeight / 2 - radius + 0.04
                && Math.hypot(v.x, v.y) <= config.maxSpeed + 1e-6;
        });
    }

    private finish(reason: 'stopped' | 'timeout' | 'invalid'): void {
        const source = reason === 'invalid' ? this.beforeLaunch! : this.state;
        const zero = { x: 0, y: 0 };
        this.state = { ...source, revision: this.state.revision + 1, phase: 'Resolving',
            players: source.players.map(p => ({ ...p, velocity: { ...zero } })),
            ball: { ...source.ball, velocity: { ...zero } } };
        this.physics!.stop(); this.physics!.restore(this.state);
        this.recordSnapshot();
        this.state = { ...this.state, revision: this.state.revision + 1,
            phase: 'Aiming', turnNumber: this.state.turnNumber + 1 };
        this.endReason = reason; this.accumulator = 0; this.acceptedIds.clear();
        this.recordSnapshot();
    }

    private recordSnapshot(): void {
        this.snapshots.push(copy(this.state));
        if (this.snapshots.length > 100) this.snapshots.shift();
    }

    execute(input: unknown, sessionOperatorId: string): CommandResult {
        const checked = validateCommand(this.state, input, sessionOperatorId, this.acceptedIds);
        if (!checked.ok) return checked;
        // 只记录协议字段，丢弃调用方额外载荷（含非 JSON 对象/自报比分）。
        const c = checked.command;
        const command: Command = {
            type: c.type, commandId: c.commandId, matchId: c.matchId,
            turnNumber: c.turnNumber, operatorId: c.operatorId, playerId: c.playerId,
            direction: { x: c.direction.x, y: c.direction.y }, power: c.power,
        };
        this.beforeLaunch = copy(this.state);
        this.recordSnapshot();
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Simulating' };
        this.acceptedIds.add(command.commandId);
        this.commands.push(command);
        if (this.commands.length > 100) this.commands.shift();
        this.accumulator = 0; this.steps = 0; this.quietSteps = 0; this.droppedSeconds = 0;
        this.endReason = 'moving';
        if (this.physics) {
            try { this.physics.launch(command); } catch { this.finish('invalid'); }
        }
        this.recordSnapshot();
        return { ok: true, revision: this.state.revision };
    }
}
