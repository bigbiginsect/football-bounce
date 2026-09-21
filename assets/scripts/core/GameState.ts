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
}
export type MatchPhase = 'Aiming' | 'Simulating' | 'Resolving' | 'Finished';
export interface GameState {
    readonly schemaVersion: 1;
    readonly revision: number;
    readonly matchId: string;
    readonly configVersion: string;
    readonly turnNumber: number;
    readonly phase: MatchPhase;
    readonly activeOperatorId: string;
    readonly clock: { readonly elapsedMs: number; readonly remainingMs: number };
    readonly score: Readonly<Record<string, number>>;
    readonly players: readonly PlayerState[];
    readonly ball: BodyState;
    readonly result: null | { readonly winnerId: string | null };
}
