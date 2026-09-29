/** 仅存 JSON 数据；坐标为米、速度为米/秒，球场中心为原点，右/上为正。 */
export interface Vector2Data { readonly x: number; readonly y: number }
export interface BodyState {
    readonly position: Vector2Data;
    readonly velocity: Vector2Data;
}
export interface PlayerState extends BodyState {
    readonly instanceId: string;
    readonly templateId: string;
    readonly ownerId: string;
    readonly skill?: {
        readonly id: string;
        readonly params: Readonly<Record<string, string | number | boolean>>;
    };
}
export type MatchPhase = 'Aiming' | 'Simulating' | 'Resolving' | 'Finished';
export interface KickoffState {
    readonly players: readonly { readonly instanceId: string; readonly position: Vector2Data }[];
    readonly ballPosition: Vector2Data;
    /** true 表示下一次有效发射仍受“开球不能直接进球”限制。 */
    readonly pending: boolean;
}
export interface AimWobbleEffect {
    readonly sourcePlayerId: string;
    readonly targetOperatorId: string;
    readonly amplitudeDegrees: number;
    readonly frequencyHz: number;
    readonly phaseRadians: number;
}
export interface MatchSkillState {
    /** 只累计对应技能球员的正常发射；奖励行动不计入。 */
    readonly launchCounts: Readonly<Record<string, number>>;
    readonly aimWobble: AimWobbleEffect | null;
    /** 仅在一次已武装的模拟期间存在；接触事实随快照保存。 */
    readonly bonus: null | { readonly playerId: string; readonly opponentHit: boolean };
    /** 奖励回合只能由该实例行动。 */
    readonly forcedPlayerId: string | null;
}
export interface GameState {
    readonly schemaVersion: 5;
    readonly revision: number;
    readonly matchId: string;
    readonly modeId: string;
    readonly configVersion: string;
    readonly catalogVersion: string;
    readonly turnNumber: number;
    readonly phase: MatchPhase;
    readonly activeOperatorId: string;
    readonly clock: {
        readonly matchDurationMs: number;
        readonly elapsedMs: number;
        readonly remainingMs: number;
        readonly turnDurationMs: number;
        readonly turnRemainingMs: number;
    };
    readonly random: {
        readonly seed: number;
        readonly state: number;
        readonly firstOperatorId: string;
    };
    readonly score: Readonly<Record<string, number>>;
    readonly players: readonly PlayerState[];
    readonly ball: BodyState;
    readonly kickoff: KickoffState;
    readonly skills: MatchSkillState;
    readonly result: null | { readonly winnerId: string | null; readonly reason: 'TimeExpired' };
}
