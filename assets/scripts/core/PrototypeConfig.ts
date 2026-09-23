import type { GameState } from './GameState';

/** 阶段 1 物理基线与阶段 2 标准模式参数。修改后停止并重新运行预览，同时更新 version。 */
export const prototypeConfig = {
    version: 'stage2-001',
    fieldWidth: 6.8, fieldHeight: 10.5, wallThickness: 0.25,
    goalWidth: 2.4, goalDepth: 0.6,
    playerRadius: 0.28, ballRadius: 0.15,
    playerMass: 2, ballMass: 0.45,
    playerDamping: 0.9, ballDamping: 0.5,
    friction: 0.15, playerRestitution: 0.75, ballRestitution: 0.85, wallRestitution: 0.85,
    maxImpulse: 14, maxSpeed: 12,
    dragDeadZone: 0.08, fullPowerDrag: 1.5, aimLength: 2,
    aimDashLength: 0.12, aimDashGap: 0.08,
    powerCircleMaxRadius: 0.9, powerCircleOpacity: 0.22,
    wallReleaseGap: 0.04, wallContactTolerance: 0.015,
    fixedStep: 1 / 60, maxSubSteps: 5,
    stopSpeed: 0.02, quietSeconds: 0.3, maxSimulationSeconds: 15,
    matchSeconds: 180, aimingSeconds: 20,
} as const;
export type PrototypeConfig = { readonly [K in keyof typeof prototypeConfig]:
    K extends 'version' ? string : number };

export function freezeConfig(input: unknown): PrototypeConfig {
    if (typeof input !== 'object' || input === null) throw new Error('物理配置必须为对象');
    const data = input as Record<string, unknown>;
    if (typeof data.version !== 'string' || !data.version.trim()) throw new Error('配置 version 不能为空');
    const limits: Record<Exclude<keyof PrototypeConfig, 'version'>, readonly [number, number]> = {
        fieldWidth: [6.8, 6.8], fieldHeight: [10.5, 10.5], wallThickness: [0.1, 1],
        goalWidth: [1.2, 4], goalDepth: [0.3, 1.5],
        playerRadius: [0.1, 0.4], ballRadius: [0.08, 0.2], playerMass: [0.1, 10], ballMass: [0.1, 10],
        playerDamping: [0, 10], ballDamping: [0, 10], friction: [0, 1],
        playerRestitution: [0, 1], ballRestitution: [0, 1], wallRestitution: [0, 1],
        maxImpulse: [0.1, 30], maxSpeed: [0.5, 20], dragDeadZone: [0, 0.5],
        fullPowerDrag: [0.1, 3], aimLength: [0.1, 3], fixedStep: [1 / 120, 1 / 30],
        aimDashLength: [0.02, 0.5], aimDashGap: [0.02, 0.5],
        powerCircleMaxRadius: [0.4, 2], powerCircleOpacity: [0.05, 0.5],
        wallReleaseGap: [0.02, 0.1], wallContactTolerance: [0.005, 0.03],
        maxSubSteps: [1, 10], stopSpeed: [0.001, 0.2], quietSeconds: [0.05, 2],
        maxSimulationSeconds: [0.1, 60],
        matchSeconds: [10, 3600], aimingSeconds: [3, 120],
    };
    const result: Record<string, string | number> = { version: data.version };
    for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
        const value = data[key]; const [min, max] = limits[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
            throw new Error(`配置 ${key} 必须在 ${min}～${max} 之间`);
        }
        result[key] = value;
    }
    if (!Number.isInteger(data.maxSubSteps) || Number(data.fullPowerDrag) <= Number(data.dragDeadZone)) {
        throw new Error('补步数必须为整数，满力度拖距必须大于死区');
    }
    if (Number(data.wallReleaseGap) <= Number(data.wallContactTolerance)
        || Number(data.powerCircleMaxRadius) <= Number(data.playerRadius)) {
        throw new Error('贴墙释放间隙必须大于接触带，力度圆最大半径必须大于球员半径');
    }
    if (Number(data.goalWidth) + 2 * Number(data.playerRadius) >= Number(data.fieldWidth)
        || Number(data.goalWidth) <= 2 * Number(data.ballRadius)) {
        throw new Error('球门必须容纳皮球，并在两侧保留边界');
    }
    return Object.freeze(result) as PrototypeConfig;
}

export type Fixture = 'normal' | 'dense' | 'wall' | 'corner';
export function createPrototypeState(matchId: string, config: PrototypeConfig, fixture: Fixture): GameState {
    const body = (x: number, y: number) => ({ position: { x, y }, velocity: { x: 0, y: 0 } });
    const players = [
        { ...body(fixture === 'wall' || fixture === 'corner' ? config.fieldWidth / 2 - 1.6 : 0,
            fixture === 'wall' ? 0.15 : fixture === 'corner' ? config.fieldHeight / 2 - 1.6 : -2.5),
            instanceId: 'a1', templateId: 'prototype-player', ownerId: 'a' },
        { ...body(fixture === 'normal' ? 0.7 : 0, 1), instanceId: 'b1', templateId: 'prototype-player', ownerId: 'b' },
    ];
    if (fixture === 'dense') {
        for (const [i, x, y] of [[2, -0.85, 1], [3, 0.85, 1], [4, -0.45, 1.85], [5, 0.45, 1.85]]) {
            players.push({ ...body(x, y), instanceId: `b${i}`, templateId: 'prototype-player', ownerId: 'b' });
        }
    }
    const kickoff = { players: players.map(p => ({ instanceId: p.instanceId, position: { ...p.position } })),
        ballPosition: fixture === 'wall' || fixture === 'corner'
            ? { x: config.fieldWidth / 2 - config.ballRadius,
                y: fixture === 'corner' ? config.fieldHeight / 2 - config.ballRadius : 0 }
            : { x: 0, y: -0.25 } };
    return { schemaVersion: 2, revision: 0, matchId, modeId: 'practice', configVersion: config.version,
        turnNumber: 1, phase: 'Aiming', activeOperatorId: 'a',
        clock: { matchDurationMs: config.matchSeconds * 1000, elapsedMs: 0,
            remainingMs: config.matchSeconds * 1000, turnDurationMs: config.aimingSeconds * 1000,
            turnRemainingMs: config.aimingSeconds * 1000 },
        random: { seed: 1, state: 1, firstOperatorId: 'a' }, score: { a: 0, b: 0 },
        players, ball: fixture === 'wall' || fixture === 'corner'
            ? body(config.fieldWidth / 2 - config.ballRadius, fixture === 'corner' ? config.fieldHeight / 2 - config.ballRadius : 0)
            : body(0, -0.25), kickoff, result: null };
}

function nextRandomState(seed: number): number {
    return (seed + 0x6d2b79f5) >>> 0;
}

function randomValue(state: number): number {
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
}

/** 标准模式比赛。种子由组合层注入，随机推进及先手决定留在纯规则层。 */
export function createStandardMatchState(matchId: string, config: PrototypeConfig, seed: number): GameState {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('随机种子必须是 uint32');
    const normalizedSeed = (seed >>> 0) || 0x6d2b79f5;
    const randomState = nextRandomState(normalizedSeed);
    const firstOperatorId = randomValue(randomState) < 0.5 ? 'blue' : 'red';
    const body = (x: number, y: number) => ({ position: { x, y }, velocity: { x: 0, y: 0 } });
    // 临时对称开局坐标只用于阶段 2 可玩闭环；不命名或锁定为某种阵型。
    const half = [[-1.6, -3.8], [1.6, -3.8], [0, -3], [-1.25, -2], [1.25, -2]] as const;
    const players = [...half.map(([x, y], index) => ({ ...body(x, y), instanceId: `blue-${index + 1}`,
        templateId: 'standard-player', ownerId: 'blue' })),
    ...half.map(([x, y], index) => ({ ...body(x === 0 ? 0 : -x, -y), instanceId: `red-${index + 1}`,
        templateId: 'standard-player', ownerId: 'red' }))];
    const kickoff = { players: players.map(p => ({ instanceId: p.instanceId, position: { ...p.position } })),
        ballPosition: { x: 0, y: 0 } };
    const matchDurationMs = config.matchSeconds * 1000;
    const turnDurationMs = config.aimingSeconds * 1000;
    return { schemaVersion: 2, revision: 0, matchId, modeId: 'standard', configVersion: config.version,
        turnNumber: 1, phase: 'Aiming', activeOperatorId: firstOperatorId,
        clock: { matchDurationMs, elapsedMs: 0, remainingMs: matchDurationMs,
            turnDurationMs, turnRemainingMs: turnDurationMs },
        random: { seed: normalizedSeed, state: randomState, firstOperatorId },
        score: { blue: 0, red: 0 }, players, ball: body(0, 0), kickoff, result: null };
}

/** 返回进球队；要求皮球整体越线且整体位于两门柱之间。 */
export function detectGoal(state: Pick<GameState, 'ball'>, config: PrototypeConfig): 'blue' | 'red' | null {
    const ball = state.ball; const halfLine = config.fieldHeight / 2;
    if (Math.abs(ball.position.x) + config.ballRadius > config.goalWidth / 2 + 1e-9) return null;
    if (ball.position.y - config.ballRadius >= halfLine - 1e-9) return 'blue';
    if (ball.position.y + config.ballRadius <= -halfLine + 1e-9) return 'red';
    return null;
}
