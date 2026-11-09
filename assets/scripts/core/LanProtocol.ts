import type { Command } from './Command';
import { isCommand } from './Command';
import type { ConditionSession, GameState } from './GameState';
import type { FormationId } from './Lineup';
import { formationPositions, isFormationId, validateLineups } from './Lineup';
import type { PlayerCatalog } from './PlayerCatalog';
import type { PrototypeConfig } from './PrototypeConfig';
import { isPlayablePosition } from './BoundaryGeometry';

export const lanSettings = Object.freeze({ protocol: 1, port: 8765, snapshotSeconds: 0.05,
    heartbeatSeconds: 1, timeoutSeconds: 8, handshakeSeconds: 8, maxMessageLength: 65536 });
export type LanSide = 'blue' | 'red';
export interface TeamSelection { readonly formationId: FormationId; readonly templateIds: readonly string[] }
export interface RoomStatus {
    readonly roomId: string; readonly round: number; readonly connected: boolean;
    readonly stage: 'Selecting' | 'Playing' | 'Finished';
    readonly blueReady: boolean; readonly redReady: boolean;
}
export type ClientMessage =
    | { readonly type: 'Hello'; readonly signature: string }
    | { readonly type: 'Ready'; readonly round: number; readonly selection: TeamSelection }
    | { readonly type: 'Launch'; readonly command: Command }
    | { readonly type: 'Rematch'; readonly round: number }
    | { readonly type: 'Ping' } | { readonly type: 'Leave' };
export type SimulationStatus = { readonly reason: 'ready' | 'moving' | 'stopped' | 'timeout' | 'invalid' | 'goal'
    | 'kickoff-violation' | 'turn-timeout' | 'skill-bonus' | 'finished';
    readonly seconds: number; readonly droppedSeconds: number };
export type ServerMessage =
    | { readonly type: 'Welcome'; readonly signature: string; readonly conditions: ConditionSession;
        readonly room: RoomStatus }
    | { readonly type: 'Lobby'; readonly room: RoomStatus }
    | { readonly type: 'Snapshot'; readonly round: number; readonly state: GameState;
        readonly status: SimulationStatus; readonly ballAngle: number }
    | { readonly type: 'Rejected'; readonly reason: string; readonly commandId: string }
    | { readonly type: 'Ended'; readonly reason: string } | { readonly type: 'Pong' };

export function cloneLan<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 160;
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 比较实际配置内容，防止只改参数却忘记升级版本号的安装包互连。不是鉴权密钥。 */
export function lanSignature(config: PrototypeConfig, catalog: PlayerCatalog): string {
    const canonical = (value: unknown): string => {
        if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
        if (record(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
        return JSON.stringify(value);
    };
    let hash = 2166136261;
    for (const c of canonical({ config, catalog })) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
    return `lan-${lanSettings.protocol}/${config.version}/${catalog.version}/${hash.toString(16)}`;
}
export function decodeLan(data: unknown): Record<string, unknown> | null {
    if (typeof data !== 'string' || data.length > lanSettings.maxMessageLength) return null;
    try { const value: unknown = JSON.parse(data); return record(value) && text(value.type) ? value : null; }
    catch { return null; }
}
export function parseSelection(value: unknown, catalog: PlayerCatalog): TeamSelection | null {
    if (!record(value) || !isFormationId(value.formationId) || !Array.isArray(value.templateIds)
        || value.templateIds.length !== 5 || new Set(value.templateIds).size !== 5
        || !value.templateIds.every(id => typeof id === 'string' && catalog.players.some(p => p.id === id))) return null;
    return { formationId: value.formationId, templateIds: [...value.templateIds] as string[] };
}
export function selectionLineup(selection: TeamSelection, side: LanSide) {
    const positions = formationPositions(selection.formationId, side);
    return selection.templateIds.map((templateId, index) => ({ templateId, position: positions[index] }));
}
export function parseClientMessage(data: unknown, catalog: PlayerCatalog): ClientMessage | null {
    const v = decodeLan(data); if (!v) return null;
    switch (v.type) {
    case 'Hello': return text(v.signature) ? { type: 'Hello', signature: v.signature } : null;
    case 'Ready': {
        const selection = parseSelection(v.selection, catalog);
        return integer(v.round, 1) && selection ? { type: 'Ready', round: v.round, selection } : null;
    }
    case 'Launch': return isCommand(v.command) ? { type: 'Launch', command: v.command } : null;
    case 'Rematch': return integer(v.round, 1) ? { type: 'Rematch', round: v.round } : null;
    case 'Ping': case 'Leave': return { type: v.type };
    default: return null;
    }
}
export function validRoom(v: unknown): v is RoomStatus {
    return record(v) && text(v.roomId) && integer(v.round, 1) && typeof v.connected === 'boolean'
        && ['Selecting', 'Playing', 'Finished'].indexOf(String(v.stage)) >= 0
        && typeof v.blueReady === 'boolean' && typeof v.redReady === 'boolean';
}
export function validConditions(v: unknown, catalog: PlayerCatalog): v is ConditionSession {
    return record(v) && integer(v.seed) && v.seed <= 0xffffffff && integer(v.randomState) && v.randomState <= 0xffffffff
        && record(v.values) && Object.keys(v.values).length === catalog.players.length
        && catalog.players.every(p => ['up', 'normal', 'down'].indexOf(String((v.values as Record<string, unknown>)[p.id])) >= 0);
}
export function validStatus(v: unknown): v is SimulationStatus {
    return record(v) && ['ready', 'moving', 'stopped', 'timeout', 'invalid', 'goal', 'kickoff-violation',
        'turn-timeout', 'skill-bonus', 'finished'].indexOf(String(v.reason)) >= 0
        && finite(v.seconds) && v.seconds >= 0 && finite(v.droppedSeconds) && v.droppedSeconds >= 0;
}

/** 客端只展示通过结构/边界校验的快照，绝不将收到的状态交给 LocalMatch 继续模拟。 */
export function validSnapshot(v: unknown, config: PrototypeConfig, catalog: PlayerCatalog): v is GameState {
    if (!record(v) || v.schemaVersion !== 6 || !text(v.matchId) || !integer(v.revision) || !integer(v.turnNumber, 1)
        || v.configVersion !== config.version || v.catalogVersion !== catalog.version || v.modeId !== 'standard'
        || ['Aiming', 'Simulating', 'Finished'].indexOf(String(v.phase)) < 0
        || ['blue', 'red'].indexOf(String(v.activeOperatorId)) < 0 || !validConditions(v.conditions, catalog)
        || !record(v.clock) || !record(v.random) || !record(v.score) || !record(v.kickoff) || !record(v.skills)
        || !Array.isArray(v.players) || v.players.length !== 10) return false;
    const vector = (p: unknown): p is { x: number; y: number } => record(p) && finite(p.x) && finite(p.y);
    const body = (b: unknown, radius: number): boolean => record(b) && vector(b.position) && vector(b.velocity)
        && isPlayablePosition(b.position, radius, config) && Math.hypot(b.velocity.x, b.velocity.y) <= config.maxSpeed + 1e-6;
    if (!body(v.ball, config.ballRadius) || !v.players.every(p => record(p) && text(p.instanceId) && text(p.templateId)
        && ['blue', 'red'].indexOf(String(p.ownerId)) >= 0 && body(p, config.playerRadius)
        && catalog.players.some(t => t.id === p.templateId)
        && record(p.attributes) && ['weight', 'power', 'precision', 'mentality', 'curve'].every(k =>
            integer((p.attributes as Record<string, unknown>)[k]) && ((p.attributes as Record<string, unknown>)[k] as number) <= 100)
        && (p.skill === undefined || (record(p.skill) && text(p.skill.id) && record(p.skill.params)
            && Object.keys(p.skill.params).every(k => {
                const x = (p.skill as { params: Record<string, unknown> }).params[k];
                return typeof x === 'boolean' || typeof x === 'string' || finite(x);
            }))))) return false;
    const players = v.players as unknown as GameState['players'];
    const ids = new Set(players.map(p => p.instanceId));
    if (ids.size !== 10 || ['blue', 'red'].some(side => players.filter(p => p.ownerId === side).length !== 5)) return false;
    const clock = v.clock;
    if (!['elapsedMs', 'remainingMs', 'matchDurationMs', 'turnDurationMs', 'turnRemainingMs'].every(k =>
        finite(clock[k]) && (clock[k] as number) >= 0)
        || clock.matchDurationMs !== config.matchSeconds * 1000 || clock.turnDurationMs !== config.aimingSeconds * 1000
        || (clock.remainingMs as number) > (clock.matchDurationMs as number) + 1e-6
        || (clock.elapsedMs as number) > (clock.matchDurationMs as number) + 1e-6
        || (clock.turnRemainingMs as number) > (clock.turnDurationMs as number) + 1e-6
        || !['seed', 'state'].every(k => integer((v.random as Record<string, unknown>)[k])
            && ((v.random as Record<string, unknown>)[k] as number) <= 0xffffffff)
        || ['blue', 'red'].indexOf(String(v.random.firstOperatorId)) < 0
        || !['blue', 'red'].every(side => integer((v.score as Record<string, unknown>)[side]))) return false;
    if (typeof v.kickoff.pending !== 'boolean' || !vector(v.kickoff.ballPosition)
        || !Array.isArray(v.kickoff.players) || v.kickoff.players.length !== 10
        || new Set(v.kickoff.players.map(p => record(p) ? p.instanceId : null)).size !== 10
        || !v.kickoff.players.every(p => record(p) && ids.has(String(p.instanceId)) && vector(p.position))) return false;
    try {
        const kickoff = v.kickoff.players as unknown as GameState['kickoff']['players'];
        const team = (side: LanSide) => players.filter(p => p.ownerId === side).map(p => ({ templateId: p.templateId,
            position: kickoff.find(k => k.instanceId === p.instanceId)!.position }));
        validateLineups({ blue: team('blue'), red: team('red') }, catalog, config);
    } catch { return false; }
    const s = v.skills;
    if (!record(s.launchCounts) || !Object.keys(s.launchCounts).every(id => ids.has(id)
        && integer((s.launchCounts as Record<string, unknown>)[id]))
        || !(s.forcedPlayerId === null || ids.has(String(s.forcedPlayerId)))
        || !(s.bonus === null || (record(s.bonus) && ids.has(String(s.bonus.playerId)) && typeof s.bonus.opponentHit === 'boolean'))
        || !(s.aimWobble === null || (record(s.aimWobble) && ids.has(String(s.aimWobble.sourcePlayerId))
            && ['blue', 'red'].indexOf(String(s.aimWobble.targetOperatorId)) >= 0
            && ['amplitudeDegrees', 'frequencyHz', 'phaseRadians'].every(k => finite((s.aimWobble as Record<string, unknown>)[k]))))) return false;
    return v.phase === 'Finished'
        ? record(v.result) && v.result.reason === 'TimeExpired' && [null, 'blue', 'red'].indexOf(v.result.winnerId as string | null) >= 0
        : v.result === null;
}
