import type { Vector2Data } from './GameState';
import type { PlayerCatalog } from './PlayerCatalog';
import type { PrototypeConfig } from './PrototypeConfig';
import { getPlayerTemplate } from './PlayerCatalog';

export interface LineupSelection {
    readonly templateId: string;
    /** 球场中心为原点，右/上为正，单位米。 */
    readonly position: Vector2Data;
}
export interface MatchLineups {
    readonly blue: readonly LineupSelection[];
    readonly red: readonly LineupSelection[];
}

/** 当前阶段沿用 stage2 对称坐标；阵型尚未成为比赛规则。 */
export function defaultLineups(): MatchLineups {
    const ids = ['van-dijk', 'cristiano-ronaldo', 'de-bruyne', 'messi', 'mbappe'];
    const half = [[-1.6, -3.8], [1.6, -3.8], [0, -3], [-1.25, -2], [1.25, -2]];
    return {
        blue: ids.map((templateId, i) => ({ templateId, position: { x: half[i][0], y: half[i][1] } })),
        red: ids.map((templateId, i) => ({ templateId,
            position: { x: half[i][0] === 0 ? 0 : -half[i][0], y: -half[i][1] } })),
    };
}

/** 为未来选人界面提供唯一输入契约；不允许客户端提交物理结果。 */
export function validateLineups(input: unknown, catalog: PlayerCatalog, config: PrototypeConfig): MatchLineups {
    if (typeof input !== 'object' || input === null) throw new Error('阵容必须为对象');
    const source = input as Record<string, unknown>;
    const positions: Vector2Data[] = [];
    const result = {} as Record<'blue' | 'red', LineupSelection[]>;
    for (const side of ['blue', 'red'] as const) {
        const team = source[side];
        if (!Array.isArray(team) || team.length !== 5) throw new Error(`${side} 必须选择 5 名球员`);
        const selected = new Set<string>();
        result[side] = team.map((item: unknown): LineupSelection => {
            if (typeof item !== 'object' || item === null) throw new Error('阵容项无效');
            const entry = item as Record<string, unknown>;
            if (typeof entry.templateId !== 'string') throw new Error('球员模板 ID 无效');
            getPlayerTemplate(catalog, entry.templateId);
            if (selected.has(entry.templateId)) throw new Error(`${side} 队内球员重复：${entry.templateId}`);
            selected.add(entry.templateId);
            if (typeof entry.position !== 'object' || entry.position === null) throw new Error('开局位置无效');
            const point = entry.position as Record<string, unknown>;
            const x = point.x; const y = point.y;
            if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
                || Math.abs(x) > config.fieldWidth / 2 - config.playerRadius
                || Math.abs(y) > config.fieldHeight / 2 - config.playerRadius
                || (side === 'blue' ? y > -config.playerRadius : y < config.playerRadius)
                || Math.hypot(x, y) <= config.playerRadius + config.ballRadius) {
                throw new Error(`${side} 开局位置超出合法区域`);
            }
            if (positions.some(other => Math.hypot(x - other.x, y - other.y) <= config.playerRadius * 2)) {
                throw new Error('开局球员位置重叠');
            }
            const position = { x, y }; positions.push(position);
            return { templateId: entry.templateId, position };
        });
    }
    return result;
}
