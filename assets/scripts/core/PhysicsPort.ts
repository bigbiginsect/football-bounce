import type { BodyState, GameState } from './GameState';
import type { Command } from './Command';

export interface PhysicsFrame {
    readonly players: readonly (BodyState & { readonly instanceId: string })[];
    readonly ball: BodyState;
}
/** 单位米、米/秒；引擎对象不能越过此边界。 */
export interface PhysicsPort {
    restore(state: GameState): void;
    launch(command: Command): void;
    step(seconds: number): void;
    sample(): PhysicsFrame;
    stop(): void;
}
