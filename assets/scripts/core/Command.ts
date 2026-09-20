import type { Vector2Data } from './GameState';

/** 意图协议；操作者真实身份必须由会话另外提供。新增意图时扩展判别联合。 */
export type Command = {
    readonly type: 'Launch';
    readonly commandId: string;
    readonly matchId: string;
    readonly turnNumber: number;
    readonly operatorId: string;
    readonly playerId: string;
    readonly direction: Vector2Data;
    readonly power: number;
};

export function isCommand(value: unknown): value is Command {
    if (typeof value !== 'object' || value === null) return false;
    const c = value as Record<string, unknown>;
    const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
    if (c.type !== 'Launch' || !text(c.commandId) || !text(c.matchId)
        || !text(c.operatorId) || !text(c.playerId)
        || !Number.isSafeInteger(c.turnNumber) || (c.turnNumber as number) < 1
        || typeof c.power !== 'number' || !Number.isFinite(c.power)
        || c.power <= 0 || c.power > 1
        || typeof c.direction !== 'object' || c.direction === null) return false;
    const d = c.direction as Record<string, unknown>;
    return typeof d.x === 'number' && typeof d.y === 'number'
        && Number.isFinite(d.x) && Number.isFinite(d.y)
        && Math.abs(Math.hypot(d.x, d.y) - 1) <= 1e-6;
}
