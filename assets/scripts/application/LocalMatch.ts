import type { Command } from '../core/Command';
import type { GameState } from '../core/GameState';
import { validateCommand, Rejection } from '../core/validateCommand';
import type { PhysicsFrame, PhysicsPort } from '../core/PhysicsPort';
import { detectGoal, freezeConfig, nextRandomState, PrototypeConfig, randomValue } from '../core/PrototypeConfig';
import { isPlayablePosition } from '../core/BoundaryGeometry';
import { AIM_WOBBLE_SKILL, BALL_HIT_ENCORE_SKILL, effectiveAimDirection, skillNumber } from '../core/PlayerSkills';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export type CommandResult = { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly reason: Rejection };
type EndReason = 'ready' | 'moving' | 'stopped' | 'timeout' | 'invalid' | 'goal'
    | 'kickoff-violation' | 'turn-timeout' | 'skill-bonus' | 'finished';

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
                this.recordSkillContacts(frame.ballPlayerContacts ?? []);
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
        const contacts = frame.ballPlayerContacts ?? [];
        if (frame.players.length !== this.state.players.length
            || new Set(frame.players.map(p => p.instanceId)).size !== frame.players.length
            || !this.state.players.every(p => frame.players.some(b => b.instanceId === p.instanceId))
            || new Set(contacts).size !== contacts.length
            || !contacts.every(id => this.state.players.some(player => player.instanceId === id))) return false;
        return [...frame.players.map(p => ({ body: p, radius: config.playerRadius })),
            { body: frame.ball, radius: config.ballRadius }].every(({ body, radius }) => {
            const { position: p, velocity: v } = body;
            const finite = [p.x, p.y, v.x, v.y].every(Number.isFinite);
            return finite && isPlayablePosition(p, radius, config)
                && Math.hypot(v.x, v.y) <= config.maxSpeed + 1e-6;
        });
    }

    private recordSkillContacts(playerIds: readonly string[]): void {
        const bonus = this.state.skills.bonus;
        if (!bonus || bonus.opponentHit) return;
        const source = this.state.players.find(player => player.instanceId === bonus.playerId);
        if (!source) return;
        const opponentHit = playerIds.some(id => this.state.players.some(player => player.instanceId === id
            && player.ownerId !== source.ownerId));
        if (opponentHit) this.state = { ...this.state, skills: { ...this.state.skills,
            bonus: { ...bonus, opponentHit: true } } };
    }

    private finishSimulation(reason: 'stopped' | 'timeout' | 'invalid' | 'goal', scorer?: string): void {
        const kickoffViolation = Boolean(scorer && this.state.kickoff.pending);
        const launchingOperatorId = this.state.activeOperatorId;
        // 从运动中快照恢复时没有本进程的发射前缓存，退回最近的权威快照而不是抛错。
        const bodySource = reason === 'invalid' && this.beforeLaunch ? this.beforeLaunch : this.state;
        const zero = { x: 0, y: 0 };
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Resolving',
            players: bodySource.players.map(p => ({ ...p, velocity: { ...zero } })),
            ball: { ...bodySource.ball, velocity: { ...zero } },
            ...(reason === 'invalid' ? { random: copy(bodySource.random), skills: copy(bodySource.skills) } : {}) };
        this.physics!.stop(); this.physics!.restore(this.state);
        this.recordSnapshot();
        if (scorer && !kickoffViolation) {
            this.state = { ...this.state, revision: this.state.revision + 1,
                score: { ...this.state.score, [scorer]: (this.state.score[scorer] ?? 0) + 1 } };
        }
        this.endReason = kickoffViolation ? 'kickoff-violation' : reason;
        this.accumulator = 0;
        if (kickoffViolation) {
            this.resetForKickoff(this.otherOperator(launchingOperatorId));
            if (this.state.clock.remainingMs <= 1e-9) this.finishMatch();
        } else if (this.state.clock.remainingMs <= 1e-9) {
            this.finishMatch();
        } else if (scorer) {
            this.resetForKickoff(this.otherOperator(scorer));
        } else if ((reason === 'stopped' || reason === 'timeout') && this.state.skills.bonus?.opponentHit) {
            this.grantSkillBonus();
        } else {
            if (reason === 'goal') throw new Error('进球结算缺少得分方');
            this.changeTurn(reason);
        }
    }

    private resetForKickoff(nextOperatorId: string): void {
        const zero = { x: 0, y: 0 };
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Aiming',
            turnNumber: this.state.turnNumber + 1, activeOperatorId: nextOperatorId,
            clock: { ...this.state.clock, turnRemainingMs: this.state.clock.turnDurationMs },
            kickoff: { ...this.state.kickoff, pending: true },
            skills: { ...this.state.skills, bonus: null, forcedPlayerId: null },
            players: this.state.players.map(player => {
                const kickoff = this.state.kickoff.players.find(p => p.instanceId === player.instanceId);
                if (!kickoff) throw new Error(`缺少开局位置：${player.instanceId}`);
                return { ...player, position: { ...kickoff.position }, velocity: { ...zero } };
            }),
            ball: { position: { ...this.state.kickoff.ballPosition }, velocity: { ...zero } } };
        this.physics!.restore(this.state);
        this.recordSnapshot();
    }

    private grantSkillBonus(): void {
        const playerId = this.state.skills.bonus!.playerId;
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Aiming',
            turnNumber: this.state.turnNumber + 1,
            clock: { ...this.state.clock, turnRemainingMs: this.state.clock.turnDurationMs },
            kickoff: this.state.kickoff.pending ? { ...this.state.kickoff, pending: false } : this.state.kickoff,
            skills: { ...this.state.skills, bonus: null, forcedPlayerId: playerId } };
        this.endReason = 'skill-bonus';
        this.recordSnapshot();
    }

    private changeTurn(reason: Exclude<EndReason, 'ready' | 'moving' | 'goal' | 'skill-bonus' | 'finished'>): void {
        const completesKickoff = reason === 'stopped' || reason === 'timeout';
        const aimWobble = this.state.skills.aimWobble?.targetOperatorId === this.state.activeOperatorId
            ? null : this.state.skills.aimWobble;
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Aiming',
            turnNumber: this.state.turnNumber + 1,
            activeOperatorId: this.otherOperator(this.state.activeOperatorId),
            clock: { ...this.state.clock, turnRemainingMs: this.state.clock.turnDurationMs },
            kickoff: completesKickoff && this.state.kickoff.pending
                ? { ...this.state.kickoff, pending: false } : this.state.kickoff,
            skills: { ...this.state.skills, aimWobble, bonus: null, forcedPlayerId: null } };
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
            skills: { ...this.state.skills, aimWobble: null, bonus: null, forcedPlayerId: null },
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
        const launchDirection = effectiveAimDirection(this.state, command.direction);
        this.beforeLaunch = copy(this.state);
        this.recordSnapshot();
        const player = this.state.players.find(item => item.instanceId === command.playerId)!;
        const wasForcedBonus = this.state.skills.forcedPlayerId === player.instanceId;
        const launchCounts = { ...this.state.skills.launchCounts };
        let bonus: GameState['skills']['bonus'] = null;
        if (!wasForcedBonus && player.skill?.id === BALL_HIT_ENCORE_SKILL) {
            const everyTurns = Math.max(2, Math.round(skillNumber(player, BALL_HIT_ENCORE_SKILL, 'everyTurns', 3)));
            const nextCount = ((launchCounts[player.instanceId] ?? 0) + 1) % everyTurns;
            launchCounts[player.instanceId] = nextCount;
            if (nextCount === 0) bonus = { playerId: player.instanceId, opponentHit: false };
        }
        let aimWobble = this.state.skills.aimWobble?.targetOperatorId === this.state.activeOperatorId
            ? null : this.state.skills.aimWobble;
        let randomState = this.state.random.state;
        if (player.skill?.id === AIM_WOBBLE_SKILL) {
            randomState = nextRandomState(randomState);
            const chance = Math.max(0, Math.min(1, skillNumber(player, AIM_WOBBLE_SKILL, 'chance', 0)));
            if (randomValue(randomState) < chance) {
                randomState = nextRandomState(randomState);
                aimWobble = { sourcePlayerId: player.instanceId,
                    targetOperatorId: this.otherOperator(this.state.activeOperatorId),
                    amplitudeDegrees: skillNumber(player, AIM_WOBBLE_SKILL, 'amplitudeDegrees', 9),
                    frequencyHz: skillNumber(player, AIM_WOBBLE_SKILL, 'frequencyHz', 1.4),
                    phaseRadians: randomValue(randomState) * Math.PI * 2 };
            }
        }
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Simulating',
            random: { ...this.state.random, state: randomState },
            skills: { launchCounts, aimWobble, bonus, forcedPlayerId: null } };
        this.acceptedIds.add(command.commandId);
        this.commands.push(command);
        if (this.commands.length > 100) {
            const removed = this.commands.shift();
            if (removed) this.acceptedIds.delete(removed.commandId);
        }
        this.accumulator = 0; this.steps = 0; this.quietSteps = 0; this.droppedSeconds = 0;
        this.endReason = 'moving';
        if (this.physics) {
            try { this.physics.launch({ ...command, direction: launchDirection }); }
            catch { this.finishSimulation('invalid'); }
        }
        this.recordSnapshot();
        return { ok: true, revision: this.state.revision };
    }
}
