import type { PrototypeConfig } from './PrototypeConfig';
import type { ConditionSession, GameState, PlayerAttributes, PlayerCondition, PlayerState } from './GameState';

export interface PlayerTemplate {
    readonly id: string;
    readonly name: string;
    readonly rarity: PlayerRarity;
    /** resources 内 SpriteFrame 的图片路径，不含 /spriteFrame 后缀。 */
    readonly portraitPath?: string;
    readonly weight: number;
    readonly power: number;
    readonly precision: number;
    /** 心理决定启动时抽取红/无/绿状态的概率，本身不受状态和半场技能影响。 */
    readonly mentality: number;
    /** 状态/半场技能会改变评分；弧线发射物理尚未启用。 */
    readonly curve: number;
    readonly quip: string;
    readonly skill?: { readonly id: string; readonly name?: string;
        readonly params: Readonly<Record<string, string | number | boolean>> };
}

export type PlayerRarity = 'red' | 'gold' | 'purple' | 'blue';

export function playerRarityPresentation(rarity: PlayerRarity): { name: string; rgb: readonly [number, number, number] } {
    switch (rarity) {
        case 'red': return { name: '红 · 传奇', rgb: [225, 58, 66] };
        case 'gold': return { name: '金 · 巨星', rgb: [232, 174, 56] };
        case 'purple': return { name: '紫 · 精英', rgb: [154, 100, 216] };
        case 'blue': return { name: '蓝 · 新锐', rgb: [69, 151, 221] };
    }
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
            || !text(entry.name) || ['red', 'gold', 'purple', 'blue'].indexOf(String(entry.rarity)) < 0
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
            if (!object(entry.skill) || !text(entry.skill.id) || !object(entry.skill.params)
                || (entry.skill.name !== undefined && (!text(entry.skill.name) || entry.skill.name.length > 16))) {
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
            if (entry.skill.id === 'power-burst') {
                const everyTurns = params.everyTurns; const multiplier = params.multiplier;
                if (typeof everyTurns !== 'number' || !Number.isInteger(everyTurns) || everyTurns < 2 || everyTurns > 8
                    || typeof multiplier !== 'number' || multiplier <= 1 || multiplier > 1.25) {
                    throw new Error(`球员 ${entry.id} 的强力发射技能参数无效`);
                }
            }
            if (entry.skill.id === 'aim-boost' || entry.skill.id === 'mass-boost') {
                const multiplier = params.multiplier;
                if (typeof multiplier !== 'number' || multiplier <= 1 || multiplier > 1.25) {
                    throw new Error(`球员 ${entry.id} 的被动技能参数无效`);
                }
            }
            if (entry.skill.id === 'half-all-aura' || entry.skill.id === 'half-playmaker-aura') {
                if (typeof params.percent !== 'number' || params.percent <= 0 || params.percent > 0.5) {
                    throw new Error(`球员 ${entry.id} 的半场技能参数无效`);
                }
            }
            if (['aim-wobble', 'ball-hit-encore', 'power-burst', 'aim-boost', 'mass-boost',
                'half-all-aura', 'half-playmaker-aura'].indexOf(entry.skill.id) < 0) {
                throw new Error(`球员 ${entry.id} 的技能 ID 无效`);
            }
            skill = Object.freeze({ id: entry.skill.id,
                ...(entry.skill.name ? { name: entry.skill.name } : {}), params: Object.freeze(params) });
        }
        return Object.freeze({ id: entry.id, name: entry.name, rarity: entry.rarity as PlayerRarity,
            ...(entry.portraitPath ? { portraitPath: entry.portraitPath } : {}),
            weight: entry.weight as number, power: entry.power as number,
            precision: entry.precision as number, mentality: entry.mentality as number,
            curve: entry.curve as number, quip: entry.quip, ...(skill ? { skill } : {}) });
    });
    return Object.freeze({ version: input.version, players: Object.freeze(players) });
}

export function playerSkillPresentation(template: PlayerTemplate): PlayerSkillPresentation | null {
    const skillName = template.skill?.name;
    if (template.skill?.id === 'half-all-aura' || template.skill?.id === 'half-playmaker-aura') {
        const stats = template.skill.id === 'half-all-aura' ? '力量、精准、弧度' : '力量、精准';
        const percent = Math.round(Number(template.skill.params.percent) * 100);
        return { name: skillName ?? '中场指挥', description: `本人在己方半场时，本队场上全员${stats}提升${percent}%；进入对方半场则使对手场上全员对应属性降低${percent}%。重量与心理不变。` };
    }
    if (template.skill?.id === 'aim-wobble') {
        const chance = Number(template.skill.params.chance);
        const amplitude = Number(template.skill.params.amplitudeDegrees);
        return { name: skillName ?? '压迫气场', description: `行动后有 ${Math.round(chance * 100)}% 概率让对手下一次瞄准线左右摆动，最大偏转 ${amplitude}°。` };
    }
    if (template.skill?.id === 'ball-hit-encore') {
        const everyTurns = Number(template.skill.params.everyTurns);
        return { name: skillName ?? '桑巴连击', description: `每第 ${everyTurns} 次正常行动，若皮球碰到敌方球员且未进球，可由本人追加行动一次。` };
    }
    if (template.skill?.id === 'power-burst') return { name: skillName ?? '强力发射',
        description: `每第 ${template.skill.params.everyTurns} 次正常发射，冲量最多提升 ${Math.round((Number(template.skill.params.multiplier) - 1) * 100)}%（受速度上限限制）。` };
    if (template.skill?.id === 'aim-boost') return { name: skillName ?? '视野',
        description: `辅助瞄准线长度提升 ${Math.round((Number(template.skill.params.multiplier) - 1) * 100)}%。` };
    if (template.skill?.id === 'mass-boost') return { name: skillName ?? '稳固',
        description: `碰撞质量提升 ${Math.round((Number(template.skill.params.multiplier) - 1) * 100)}%，发射冲量同步补偿。` };
    return null;
}

export function getPlayerTemplate(catalog: PlayerCatalog, id: string): PlayerTemplate {
    const player = catalog.players.find(entry => entry.id === id);
    if (!player) throw new Error(`未知球员模板：${id}`);
    return player;
}

/** 暂定概率配置；保持中性概率不变，心理只在红色和绿色之间转移概率。 */
export const mentalityConditionConfig = Object.freeze({ neutralChance: 0.3,
    minimumUpChance: 0.1, maximumUpChance: 0.6, attributeChange: 0.2 });

export function conditionProbabilities(mentality: number) {
    if (!Number.isInteger(mentality) || mentality < 0 || mentality > 100) throw new Error('心理评分必须为0—100整数');
    const c = mentalityConditionConfig;
    const up = c.minimumUpChance + (c.maximumUpChance - c.minimumUpChance) * mentality / 100;
    return { up, normal: c.neutralChance, down: 1 - c.neutralChance - up };
}

/** 启动种子由组合层提供；记录每个模板的抽签结果，两队使用同模板时状态相同。 */
export function createPlayerConditions(catalog: PlayerCatalog, seed: number): ConditionSession {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('状态种子必须是uint32');
    let randomState = seed;
    const values: Record<string, PlayerCondition> = {};
    for (const player of catalog.players) {
        randomState = (randomState + 0x6d2b79f5) >>> 0;
        let value = Math.imul(randomState ^ (randomState >>> 15), randomState | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        const roll = ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
        const chances = conditionProbabilities(player.mentality);
        values[player.id] = roll < chances.up ? 'up' : roll < chances.up + chances.normal ? 'normal' : 'down';
    }
    return { seed, randomState, values };
}

export function conditionPresentation(condition: PlayerCondition) {
    return condition === 'up' ? { arrow: '↑', name: '状态上扬', rgb: [225, 58, 66] as const }
        : condition === 'down' ? { arrow: '↓', name: '状态低迷', rgb: [32, 165, 73] as const }
        : { arrow: '', name: '状态平稳', rgb: [100, 121, 132] as const };
}

/** 每个影响都相对基础评分相加，最后一次取整；重量/心理不进入加成循环。 */
export function effectiveAttributes(base: PlayerAttributes, condition: PlayerCondition = 'normal',
    aura: Readonly<Partial<Record<'power' | 'precision' | 'curve', number>>> = {}): PlayerAttributes {
    const change = condition === 'up' ? mentalityConditionConfig.attributeChange
        : condition === 'down' ? -mentalityConditionConfig.attributeChange : 0;
    const adjusted = (key: 'power' | 'precision' | 'curve') =>
        Math.max(0, Math.round(base[key] * (1 + change + (aura[key] ?? 0))));
    return { weight: base.weight, mentality: base.mentality,
        power: adjusted('power'), precision: adjusted('precision'), curve: adjusted('curve') };
}

/** 纯数据位置判定，蓝队下半场/红队上半场；中线归本人己方半场。 */
export function playerAuraBonuses(target: PlayerState, state: Pick<GameState, 'players'>) {
    const result = { power: 0, precision: 0, curve: 0 };
    for (const source of state.players) {
        if (source.skill?.id !== 'half-all-aura' && source.skill?.id !== 'half-playmaker-aura') continue;
        const ownHalf = source.ownerId === 'blue' ? source.position.y <= 0 : source.position.y >= 0;
        const sameTeam = source.ownerId === target.ownerId;
        if (ownHalf !== sameTeam) continue;
        const amount = Number(source.skill.params.percent) * (ownHalf ? 1 : -1);
        result.power += amount; result.precision += amount;
        if (source.skill.id === 'half-all-aura') result.curve += amount;
    }
    return result;
}

export function matchPlayerAttributes(player: PlayerState, state: GameState): PlayerAttributes | undefined {
    return player.attributes ? effectiveAttributes(player.attributes,
        state.conditions.values[player.templateId] ?? 'normal', playerAuraBonuses(player, state)) : undefined;
}

export function matchPlayerTemplate(template: PlayerTemplate, player: PlayerState, state: GameState): PlayerTemplate {
    const attributes = matchPlayerAttributes(player, state);
    return attributes ? { ...template, ...attributes } : template;
}

/** 传给物理的是相对基础冲量的权威倍率；保留质量补偿与已有强力发射机制。 */
export function conditionPowerMultiplier(player: PlayerState, state: GameState, config: PrototypeConfig): number {
    const attributes = matchPlayerAttributes(player, state);
    if (!attributes || !player.attributes) return 1;
    return (1 + (attributes.power - 50) * config.powerSpeedScalePerPoint)
        / (1 + (player.attributes.power - 50) * config.powerSpeedScalePerPoint);
}

/**
 * 评分 50 对应 stage2 基准。重量决定质量和碰撞动量；最大冲量同步补偿质量，
 * 因而同力量评分的起步速度近似一致，而重球员撞击轻球员时仍保留更大动量。
 */
export function playerGameplayValues(template: PlayerTemplate, config: PrototypeConfig) {
    const massScale = Math.pow(config.weightMassFactorPer50, (template.weight - 50) / 50)
        * (template.skill?.id === 'mass-boost' ? Number(template.skill.params.multiplier) : 1);
    const powerScale = 1 + (template.power - 50) * config.powerSpeedScalePerPoint;
    return {
        mass: config.playerMass * massScale,
        maxImpulse: config.maxImpulse * massScale * powerScale,
        aimLength: config.aimLength * (1 + (template.precision - 50) * config.precisionAimScalePerPoint)
            * (template.skill?.id === 'aim-boost' ? Number(template.skill.params.multiplier) : 1),
        powerCircleMaxRadius: config.powerCircleMaxRadius
            * (1 + (template.power - 50) * config.powerCircleScalePerPoint),
    };
}
