import type { Command } from '../core/Command';
import type { GameState } from '../core/GameState';
import { validateCommand, Rejection } from '../core/validateCommand';
import type { PhysicsFrame, PhysicsPort } from '../core/PhysicsPort';
import { detectGoal, freezeConfig, PrototypeConfig } from '../core/PrototypeConfig';
import { isPlayablePosition } from '../core/BoundaryGeometry';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export type CommandResult = { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly reason: Rejection };
type EndReason = 'ready' | 'moving' | 'stopped' | 'timeout' | 'invalid' | 'goal' | 'turn-timeout' | 'finished';

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
    private endReason: EndReason = 'ready';

    constructor(initialState: GameState, private readonly physics?: PhysicsPort, config?: PrototypeConfig) {
        this.state = copy(initialState);
        this.endReason = initialState.phase === 'Finished' ? 'finished'
            : initialState.phase === 'Simulating' ? 'moving' : 'ready';
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
    /** 生命周期暂停时不调用 advance；这里只丢弃物理积压，恢复首帧不补后台时间。 */
    discardAccumulatedTime(): void { this.accumulator = 0; }

    advance(deltaSeconds: number): void {
        const config = this.config;
        if (!config || this.state.phase === 'Finished' || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
        if (this.state.phase === 'Aiming') {
            this.advanceAiming(deltaSeconds * 1000);
            return;
        }
        if (this.state.phase !== 'Simulating' || !this.physics) return;
        this.advanceMatchClock(deltaSeconds * 1000);
        const cap = config.fixedStep * config.maxSubSteps;
        const pending = this.accumulator + deltaSeconds;
        this.accumulator = Math.min(pending, cap);
        this.droppedSeconds += Math.max(0, pending - cap);
        for (let i = 0; i < config.maxSubSteps && this.accumulator + 1e-10 >= config.fixedStep; i++) {
            this.accumulator = Math.max(0, this.accumulator - config.fixedStep);
            try {
                this.physics.step(config.fixedStep); this.steps++;
                const frame = this.physics.sample();
                if (!this.validFrame(frame)) { this.finishSimulation('invalid'); break; }
                this.state = { ...this.state, revision: this.state.revision + 1,
                    players: this.state.players.map(player => ({ ...player,
                        ...copy(frame.players.find(p => p.instanceId === player.instanceId)!) })),
                    ball: copy(frame.ball) };
                const scorer = frame.goal === 'top' ? 'blue' : frame.goal === 'bottom' ? 'red' : null;
                // 事件由物理层采集，规则层仍用权威纯数据复核，避免错误事件直接改比分。
                if (scorer !== detectGoal(this.state, config)) { this.finishSimulation('invalid'); break; }
                if (scorer) { this.finishSimulation('goal', scorer); break; }
                const quiet = [...frame.players, frame.ball].every(b => Math.hypot(b.velocity.x, b.velocity.y) <= config.stopSpeed);
                this.quietSteps = quiet ? this.quietSteps + 1 : 0;
                if (this.quietSteps >= Math.ceil(config.quietSeconds / config.fixedStep - 1e-9)) {
                    this.finishSimulation('stopped'); break;
                }
                if (this.steps >= Math.ceil(config.maxSimulationSeconds / config.fixedStep - 1e-9)) {
                    this.finishSimulation('timeout'); break;
                }
            } catch {
                this.finishSimulation('invalid'); break;
            }
        }
    }

    private advanceAiming(milliseconds: number): void {
        let pending = milliseconds;
        while (pending > 1e-9 && this.state.phase === 'Aiming') {
            const step = Math.min(pending, this.state.clock.remainingMs, this.state.clock.turnRemainingMs);
            if (step > 0) {
                this.state = { ...this.state, revision: this.state.revision + 1, clock: { ...this.state.clock,
                    elapsedMs: this.state.clock.elapsedMs + step,
                    remainingMs: Math.max(0, this.state.clock.remainingMs - step),
                    turnRemainingMs: Math.max(0, this.state.clock.turnRemainingMs - step) } };
                pending -= step;
            }
            if (this.state.clock.remainingMs <= 1e-9) {
                this.finishMatch();
            } else if (this.state.clock.turnRemainingMs <= 1e-9) {
                this.changeTurn('turn-timeout');
            } else {
                break;
            }
        }
    }

    private advanceMatchClock(milliseconds: number): void {
        const step = Math.min(milliseconds, this.state.clock.remainingMs);
        if (step <= 0) return;
        this.state = { ...this.state, revision: this.state.revision + 1, clock: { ...this.state.clock,
            elapsedMs: this.state.clock.elapsedMs + step,
            remainingMs: Math.max(0, this.state.clock.remainingMs - step) } };
    }

    private validFrame(frame: PhysicsFrame): boolean {
        const config = this.config!;
        if (frame.players.length !== this.state.players.length
            || new Set(frame.players.map(p => p.instanceId)).size !== frame.players.length
            || !this.state.players.every(p => frame.players.some(b => b.instanceId === p.instanceId))) return false;
        return [...frame.players.map(p => ({ body: p, radius: config.playerRadius })),
            { body: frame.ball, radius: config.ballRadius }].every(({ body, radius }) => {
            const { position: p, velocity: v } = body;
            const finite = [p.x, p.y, v.x, v.y].every(Number.isFinite);
            return finite && isPlayablePosition(p, radius, config)
                && Math.hypot(v.x, v.y) <= config.maxSpeed + 1e-6;
        });
    }

    private finishSimulation(reason: 'stopped' | 'timeout' | 'invalid' | 'goal', scorer?: string): void {
        // 从运动中快照恢复时没有本进程的发射前缓存，退回最近的权威快照而不是抛错。
        const bodySource = reason === 'invalid' && this.beforeLaunch ? this.beforeLaunch : this.state;
        const zero = { x: 0, y: 0 };
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Resolving',
            players: bodySource.players.map(p => ({ ...p, velocity: { ...zero } })),
            ball: { ...bodySource.ball, velocity: { ...zero } } };
        this.physics!.stop(); this.physics!.restore(this.state);
        this.recordSnapshot();
        if (scorer) {
            this.state = { ...this.state, revision: this.state.revision + 1,
                score: { ...this.state.score, [scorer]: (this.state.score[scorer] ?? 0) + 1 } };
        }
        this.endReason = reason;
        this.accumulator = 0;
        if (this.state.clock.remainingMs <= 1e-9) {
            this.finishMatch();
        } else if (scorer) {
            this.resetAfterGoal(this.otherOperator(scorer));
        } else {
            if (reason === 'goal') throw new Error('进球结算缺少得分方');
            this.changeTurn(reason);
        }
    }

    private resetAfterGoal(concedingOperatorId: string): void {
        const zero = { x: 0, y: 0 };
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Aiming',
            turnNumber: this.state.turnNumber + 1, activeOperatorId: concedingOperatorId,
            clock: { ...this.state.clock, turnRemainingMs: this.state.clock.turnDurationMs },
            players: this.state.players.map(player => {
                const kickoff = this.state.kickoff.players.find(p => p.instanceId === player.instanceId);
                if (!kickoff) throw new Error(`缺少开局位置：${player.instanceId}`);
                return { ...player, position: { ...kickoff.position }, velocity: { ...zero } };
            }),
            ball: { position: { ...this.state.kickoff.ballPosition }, velocity: { ...zero } } };
        this.physics!.restore(this.state);
        this.recordSnapshot();
    }

    private changeTurn(reason: Exclude<EndReason, 'ready' | 'moving' | 'goal' | 'finished'>): void {
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Aiming',
            turnNumber: this.state.turnNumber + 1,
            activeOperatorId: this.otherOperator(this.state.activeOperatorId),
            clock: { ...this.state.clock, turnRemainingMs: this.state.clock.turnDurationMs } };
        this.endReason = reason;
        this.recordSnapshot();
    }

    private otherOperator(operatorId: string): string {
        const owners = [...new Set(this.state.players.map(player => player.ownerId))];
        return owners.find(owner => owner !== operatorId) ?? operatorId;
    }

    private finishMatch(): void {
        const owners = [...new Set(this.state.players.map(player => player.ownerId))];
        const first = owners[0]; const second = owners[1];
        const firstScore = this.state.score[first] ?? 0; const secondScore = this.state.score[second] ?? 0;
        const winnerId = firstScore === secondScore ? null : firstScore > secondScore ? first : second;
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Finished',
            clock: { ...this.state.clock, remainingMs: 0, turnRemainingMs: 0 },
            result: { winnerId, reason: 'TimeExpired' } };
        this.endReason = 'finished'; this.accumulator = 0;
        this.recordSnapshot();
    }

    private recordSnapshot(): void {
        this.snapshots.push(copy(this.state));
        if (this.snapshots.length > 100) this.snapshots.shift();
    }

    execute(input: unknown, sessionOperatorId: string): CommandResult {
        const checked = validateCommand(this.state, input, sessionOperatorId, this.acceptedIds);
        if (!checked.ok) return checked;
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
        if (this.commands.length > 100) {
            const removed = this.commands.shift();
            if (removed) this.acceptedIds.delete(removed.commandId);
        }
        this.accumulator = 0; this.steps = 0; this.quietSteps = 0; this.droppedSeconds = 0;
        this.endReason = 'moving';
        if (this.physics) {
            try { this.physics.launch(command); } catch { this.finishSimulation('invalid'); }
        }
        this.recordSnapshot();
        return { ok: true, revision: this.state.revision };
    }
}
