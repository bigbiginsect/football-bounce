import type { PrototypeConfig } from './PrototypeConfig';

export interface PlayerTemplate {
    readonly id: string;
    readonly name: string;
    /** resources 内 SpriteFrame 的图片路径，不含 /spriteFrame 后缀。 */
    readonly portraitPath: string;
    readonly weight: number;
    readonly power: number;
    readonly precision: number;
    /** 展示用设计评分；规则效果尚未启用。 */
    readonly mentality: number;
    /** 展示用设计评分；规则效果尚未启用。 */
    readonly curve: number;
    readonly quip: string;
    readonly skill?: { readonly id: string; readonly params: Readonly<Record<string, string | number | boolean>> };
}

export interface PlayerCatalog {
    readonly version: string;
    readonly players: readonly PlayerTemplate[];
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** 外部 JSON 在运行时校验；目录与 GameState 分离，新增球员无需修改规则。 */
export function parsePlayerCatalog(input: unknown): PlayerCatalog {
    if (!object(input) || !text(input.version) || !Array.isArray(input.players) || input.players.length === 0) {
        throw new Error('球员目录缺少版本或球员列表');
    }
    const ids = new Set<string>();
    const players = input.players.map((entry: unknown): PlayerTemplate => {
        if (!object(entry) || !text(entry.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)
            || !text(entry.name) || entry.portraitPath !== `portraits/${entry.id}`) {
            throw new Error('球员 ID、名称或头像路径无效');
        }
        if (ids.has(entry.id)) throw new Error(`球员 ID 重复：${entry.id}`);
        ids.add(entry.id);
        for (const key of ['weight', 'power', 'precision', 'mentality', 'curve'] as const) {
            if (typeof entry[key] !== 'number' || !Number.isInteger(entry[key])
                || entry[key] < 0 || entry[key] > 100) throw new Error(`球员 ${entry.id} 的 ${key} 无效`);
        }
        if (!text(entry.quip) || entry.quip.length > 80) throw new Error(`球员 ${entry.id} 的 quip 无效`);
        let skill: PlayerTemplate['skill'];
        if (entry.skill !== undefined && entry.skill !== null) {
            if (!object(entry.skill) || !text(entry.skill.id) || !object(entry.skill.params)) {
                throw new Error(`球员 ${entry.id} 的技能入口无效`);
            }
            const params: Record<string, string | number | boolean> = {};
            for (const key of Object.keys(entry.skill.params)) {
                const value = entry.skill.params[key];
                if (!text(key) || (typeof value !== 'string' && typeof value !== 'boolean'
                    && (typeof value !== 'number' || !Number.isFinite(value)))) {
                    throw new Error(`球员 ${entry.id} 的技能参数无效`);
                }
                params[key] = value;
            }
            skill = Object.freeze({ id: entry.skill.id, params: Object.freeze(params) });
        }
        return Object.freeze({ id: entry.id, name: entry.name, portraitPath: entry.portraitPath,
            weight: entry.weight as number, power: entry.power as number,
            precision: entry.precision as number, mentality: entry.mentality as number,
            curve: entry.curve as number, quip: entry.quip, ...(skill ? { skill } : {}) });
    });
    return Object.freeze({ version: input.version, players: Object.freeze(players) });
}

export function getPlayerTemplate(catalog: PlayerCatalog, id: string): PlayerTemplate {
    const player = catalog.players.find(entry => entry.id === id);
    if (!player) throw new Error(`未知球员模板：${id}`);
    return player;
}

/** 评分 50 对应 stage2 物理基准；只改变质量、发射冲量和辅助瞄准长度。 */
export function playerGameplayValues(template: PlayerTemplate, config: PrototypeConfig) {
    return {
        mass: config.playerMass * (0.9 + template.weight / 500),
        maxImpulse: config.maxImpulse * (0.9 + template.power / 500),
        aimLength: config.aimLength * (0.8 + template.precision / 250),
    };
}
