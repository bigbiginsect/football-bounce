import type { BodyState, GameState } from './GameState';
import type { Command } from './Command';

export interface PhysicsFrame {
    readonly players: readonly (BodyState & { readonly instanceId: string })[];
    readonly ball: BodyState;
    /** 本固定步内与皮球开始接触的球员实例；规则层结合归属判断敌我。 */
    readonly ballPlayerContacts: readonly string[];
    /** 物理适配层采集的球门线事件；规则层决定得分方并负责防重结算。 */
    readonly goal: 'top' | 'bottom' | null;
}
/** 单位米、米/秒；引擎对象不能越过此边界。 */
export interface PhysicsPort {
    restore(state: GameState): void;
    /** multiplier 由权威技能规则计算，不属于客户端 Command。 */
    launch(command: Command, impulseMultiplier?: number): void;
    step(seconds: number): void;
    sample(): PhysicsFrame;
    stop(): void;
}
