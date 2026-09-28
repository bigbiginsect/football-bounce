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

export type FormationId = '2-1-2' | '2-2-1' | '1-2-2';
export interface FormationDefinition {
    readonly id: FormationId;
    readonly label: string;
    /** 蓝方半场坐标，顺序与五个阵容槽位一致；红方使用中心旋转后的坐标。 */
    readonly positions: readonly Vector2Data[];
}

export const defaultFormationId: FormationId = '2-1-2';

/** 数字从己方球门到进攻方向依次表示后排、中排、前排人数。 */
export const formationDefinitions: readonly FormationDefinition[] = Object.freeze([
    Object.freeze({ id: '2-1-2', label: '均衡 2-1-2', positions: Object.freeze([
        Object.freeze({ x: -1.6, y: -3.8 }), Object.freeze({ x: 1.6, y: -3.8 }),
        Object.freeze({ x: 0, y: -3 }),
        Object.freeze({ x: -1.25, y: -2 }), Object.freeze({ x: 1.25, y: -2 }),
    ]) }),
    Object.freeze({ id: '2-2-1', label: '稳守 2-2-1', positions: Object.freeze([
        Object.freeze({ x: -1.6, y: -3.85 }), Object.freeze({ x: 1.6, y: -3.85 }),
        Object.freeze({ x: -1.3, y: -2.9 }), Object.freeze({ x: 1.3, y: -2.9 }),
        Object.freeze({ x: 0, y: -1.85 }),
    ]) }),
    Object.freeze({ id: '1-2-2', label: '进攻 1-2-2', positions: Object.freeze([
        Object.freeze({ x: 0, y: -3.95 }),
        Object.freeze({ x: -1.45, y: -3 }), Object.freeze({ x: 1.45, y: -3 }),
        Object.freeze({ x: -1.3, y: -1.95 }), Object.freeze({ x: 1.3, y: -1.95 }),
    ]) }),
]);

export function isFormationId(value: unknown): value is FormationId {
    return typeof value === 'string' && formationDefinitions.some(formation => formation.id === value);
}

export function getFormation(id: FormationId): FormationDefinition {
    return formationDefinitions.find(formation => formation.id === id)!;
}

export function formationPositions(id: FormationId, side: 'blue' | 'red'): readonly Vector2Data[] {
    return getFormation(id).positions.map(point => side === 'blue'
        ? { x: point.x, y: point.y }
        : { x: point.x === 0 ? 0 : -point.x, y: -point.y });
}

export function inferFormationId(team: readonly LineupSelection[], side: 'blue' | 'red'): FormationId {
    const match = formationDefinitions.find(formation => {
        const positions = formationPositions(formation.id, side);
        return team.length === positions.length && team.every((item, index) =>
            Math.abs(item.position.x - positions[index].x) < 1e-6
            && Math.abs(item.position.y - positions[index].y) < 1e-6);
    });
    return match?.id ?? defaultFormationId;
}

/** 默认使用参考图的 2-1-2；实际坐标由双方赛前选择的阵型决定。 */
export function defaultLineups(): MatchLineups {
    const ids = ['van-dijk', 'cristiano-ronaldo', 'de-bruyne', 'messi', 'mbappe'];
    const blue = formationPositions(defaultFormationId, 'blue');
    const red = formationPositions(defaultFormationId, 'red');
    return {
        blue: ids.map((templateId, index) => ({ templateId, position: blue[index] })),
        red: ids.map((templateId, index) => ({ templateId, position: red[index] })),
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
