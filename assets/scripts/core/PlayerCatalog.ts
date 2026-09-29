import type { PrototypeConfig } from './PrototypeConfig';

export interface PlayerTemplate {
    readonly id: string;
    readonly name: string;
    /** resources 内 SpriteFrame 的图片路径，不含 /spriteFrame 后缀。 */
    readonly portraitPath?: string;
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

export interface PlayerSkillPresentation {
    readonly name: string;
    readonly description: string;
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
            || !text(entry.name)
            || (entry.portraitPath !== undefined && entry.portraitPath !== `portraits/${entry.id}`)) {
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
            if (entry.skill.id === 'aim-wobble') {
                const chance = params.chance; const amplitude = params.amplitudeDegrees;
                const frequency = params.frequencyHz;
                if (typeof chance !== 'number' || chance < 0 || chance > 1
                    || typeof amplitude !== 'number' || amplitude <= 0 || amplitude > 20
                    || typeof frequency !== 'number' || frequency < 0.2 || frequency > 4) {
                    throw new Error(`球员 ${entry.id} 的瞄准干扰技能参数无效`);
                }
            }
            if (entry.skill.id === 'ball-hit-encore') {
                const everyTurns = params.everyTurns;
                if (typeof everyTurns !== 'number' || !Number.isInteger(everyTurns)
                    || everyTurns < 2 || everyTurns > 10) {
                    throw new Error(`球员 ${entry.id} 的追加行动技能参数无效`);
                }
            }
            skill = Object.freeze({ id: entry.skill.id, params: Object.freeze(params) });
        }
        return Object.freeze({ id: entry.id, name: entry.name,
            ...(entry.portraitPath ? { portraitPath: entry.portraitPath } : {}),
            weight: entry.weight as number, power: entry.power as number,
            precision: entry.precision as number, mentality: entry.mentality as number,
            curve: entry.curve as number, quip: entry.quip, ...(skill ? { skill } : {}) });
    });
    return Object.freeze({ version: input.version, players: Object.freeze(players) });
}

export function playerSkillPresentation(template: PlayerTemplate): PlayerSkillPresentation | null {
    if (template.skill?.id === 'aim-wobble') {
        const chance = Number(template.skill.params.chance);
        const amplitude = Number(template.skill.params.amplitudeDegrees);
        return { name: '压迫气场', description: `行动后有 ${Math.round(chance * 100)}% 概率让对手下一次瞄准线左右摆动，最大偏转 ${amplitude}°。` };
    }
    if (template.skill?.id === 'ball-hit-encore') {
        const everyTurns = Number(template.skill.params.everyTurns);
        return { name: '桑巴连击', description: `每第 ${everyTurns} 次正常行动，若皮球碰到敌方球员且未进球，可由内马尔追加行动一次。` };
    }
    return null;
}

export function getPlayerTemplate(catalog: PlayerCatalog, id: string): PlayerTemplate {
    const player = catalog.players.find(entry => entry.id === id);
    if (!player) throw new Error(`未知球员模板：${id}`);
    return player;
}

/**
 * 评分 50 对应 stage2 基准。重量决定质量和碰撞动量；最大冲量同步补偿质量，
 * 因而同力量评分的起步速度近似一致，而重球员撞击轻球员时仍保留更大动量。
 */
export function playerGameplayValues(template: PlayerTemplate, config: PrototypeConfig) {
    const massScale = Math.pow(config.weightMassFactorPer50, (template.weight - 50) / 50);
    const powerScale = 1 + (template.power - 50) * config.powerSpeedScalePerPoint;
    return {
        mass: config.playerMass * massScale,
        maxImpulse: config.maxImpulse * massScale * powerScale,
        aimLength: config.aimLength * (1 + (template.precision - 50) * config.precisionAimScalePerPoint),
        powerCircleMaxRadius: config.powerCircleMaxRadius
            * (1 + (template.power - 50) * config.powerCircleScalePerPoint),
    };
}
