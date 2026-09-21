import type { GameState } from './GameState';

/** 阶段 1 可调假设。修改后停止并重新运行预览；同时更改 version 便于记录。 */
export const prototypeConfig = {
    version: 'stage1-003',
    fieldWidth: 6.8, fieldHeight: 10.5, wallThickness: 0.25,
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
} as const;
export type PrototypeConfig = { readonly [K in keyof typeof prototypeConfig]:
    K extends 'version' ? string : number };

export function freezeConfig(input: unknown): PrototypeConfig {
    if (typeof input !== 'object' || input === null) throw new Error('物理配置必须为对象');
    const data = input as Record<string, unknown>;
    if (typeof data.version !== 'string' || !data.version.trim()) throw new Error('配置 version 不能为空');
    const limits: Record<Exclude<keyof PrototypeConfig, 'version'>, readonly [number, number]> = {
        fieldWidth: [6.8, 6.8], fieldHeight: [10.5, 10.5], wallThickness: [0.1, 1],
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
    return { schemaVersion: 1, revision: 0, matchId, configVersion: config.version,
        turnNumber: 1, phase: 'Aiming', activeOperatorId: 'a',
        clock: { elapsedMs: 0, remainingMs: 0 }, score: { a: 0, b: 0 },
        players, ball: fixture === 'wall' || fixture === 'corner'
            ? body(config.fieldWidth / 2 - config.ballRadius, fixture === 'corner' ? config.fieldHeight / 2 - config.ballRadius : 0)
            : body(0, -0.25), result: null };
}
