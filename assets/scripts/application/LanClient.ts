import type { Command } from '../core/Command';
import type { ConditionSession, GameState } from '../core/GameState';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import { cloneLan, decodeLan, lanSettings, lanSignature, validConditions, validRoom, validSnapshot, validStatus } from '../core/LanProtocol';
import type { RoomStatus, SimulationStatus, ClientMessage, TeamSelection } from '../core/LanProtocol';
import type { LanPeer } from './LanTransport';
import type { RemoteHello, RemoteRequest } from '../core/RemoteProtocol';
import { validRemoteRoom } from '../core/RemoteProtocol';
import type { LanSide } from '../core/LanProtocol';

export interface LanClientHooks {
    welcomed(conditions: ConditionSession): void;
    roomChanged(room: RoomStatus): void;
    snapshot(state: GameState, status: SimulationStatus, ballAngle: number): void;
    rejected(reason: string): void;
    ended(reason: string): void;
}
/** 客端不持有 LocalMatch / PhysicsPort；完整快照是恢复与校正的唯一来源。 */
export class LanClient {
    private closed = false;
    private room?: RoomStatus;
    private idle = 0;
    private heartbeat = 0;
    private revision = -1;
    private matchId = '';
    private pending?: string;
    private pendingTurn = 0;
    private pendingSeconds = 0;
    private conditions?: ConditionSession;
    private started = false;
    private assignedSide: LanSide = 'red';
    private readonly signature: string;
    constructor(private readonly peer: LanPeer, private readonly config: PrototypeConfig,
        private readonly catalog: PlayerCatalog, private readonly hooks: LanClientHooks,
        private readonly remote?: RemoteRequest) {
        this.signature = lanSignature(config, catalog);
        peer.onMessage = data => this.receive(data);
        peer.onClose = () => this.close(this.remote ? '服务器连接已断开，本场已中止' : '房主已断开，本场已中止');
    }
    /** 组合层先保存实例再启动，发送失败的同步回调也能正确清理实例。 */
    start(): void {
        if (this.started || this.closed) return;
        this.started = true;
        this.send(this.remote ? { type: 'RemoteHello', signature: this.signature, ...this.remote }
            : { type: 'Hello', signature: this.signature });
    }
    get side(): LanSide { return this.assignedSide; }
    getRoom(): RoomStatus | undefined { return this.room && cloneLan(this.room); }
    private receive(data: unknown): void {
        if (this.closed) return;
        const v = decodeLan(data);
        if (!v) { this.close('收到无效房间消息'); return; }
        this.idle = 0;
        if (v.type === 'Ended' && typeof v.reason === 'string') { this.close(v.reason.slice(0, 160)); return; }
        if (!this.room) {
            if (v.type !== 'Welcome' || v.signature !== this.signature || !validRoom(v.room)
                || v.room.stage !== 'Selecting' || !validConditions(v.conditions, this.catalog)
                || (v.side !== 'blue' && v.side !== 'red')
                || (this.remote ? !validRemoteRoom(v.room) : v.side !== 'red' || v.room.kind !== undefined)) {
                this.close('房间握手失败，请确认游戏版本一致'); return;
            }
            this.assignedSide = v.side;
            this.conditions = cloneLan(v.conditions); this.room = cloneLan(v.room);
            this.hooks.welcomed(cloneLan(v.conditions)); this.hooks.roomChanged(cloneLan(v.room)); return;
        }
        if (v.type === 'Pong') return;
        if (v.type === 'Rejected' && typeof v.reason === 'string') {
            if (v.commandId === this.pending) this.pending = undefined;
            this.hooks.rejected(v.reason.slice(0, 160)); return;
        }
        if (v.type === 'Lobby' && validRoom(v.room) && v.room.roomId === this.room.roomId) {
            if (v.room.kind !== this.room.kind || v.room.code !== this.room.code) { this.close('房间身份异常'); return; }
            if (v.room.round < this.room.round) return;
            if (v.room.round > this.room.round) {
                if (this.room.stage !== 'Finished' || v.room.stage !== 'Selecting') {
                    this.close('房间回合状态异常'); return;
                }
                this.revision = -1; this.matchId = ''; this.pending = undefined;
            } else if ((this.room.stage === 'Playing' && v.room.stage === 'Selecting')
                || (this.room.stage === 'Finished' && v.room.stage !== 'Finished')) return;
            this.room = cloneLan(v.room); this.hooks.roomChanged(cloneLan(v.room)); return;
        }
        if (v.type === 'Snapshot') {
            if (v.round !== this.room.round) return;
            if (!validSnapshot(v.state, this.config, this.catalog) || !validStatus(v.status)
                || typeof v.ballAngle !== 'number' || !Number.isFinite(v.ballAngle)
                || JSON.stringify(v.state.conditions) !== JSON.stringify(this.conditions)) {
                this.close('收到不兼容的比赛快照'); return;
            }
            if (v.state.matchId !== `${this.room.roomId}-${this.room.round}`) { this.close('比赛身份不一致'); return; }
            if (v.state.revision <= this.revision || (this.matchId && this.matchId !== v.state.matchId)) return;
            this.matchId = v.state.matchId; this.revision = v.state.revision;
            // 物理发射异常可能直接结算到下一回合，不一定收到中间的Simulating快照。
            if (v.state.phase !== 'Aiming' || v.state.turnNumber !== this.pendingTurn) this.pending = undefined;
            this.hooks.snapshot(cloneLan(v.state), cloneLan(v.status), v.ballAngle); return;
        }
        this.close('房间消息不兼容');
    }
    ready(selection: TeamSelection): void {
        if (this.room?.stage === 'Selecting') this.send({ type: 'Ready', round: this.room.round, selection });
    }
    launch(command: Command): boolean {
        if (!this.room || this.room.stage !== 'Playing' || this.pending || this.closed) return false;
        this.pending = command.commandId; this.pendingTurn = command.turnNumber; this.pendingSeconds = 0;
        this.send({ type: 'Launch', command }); return !this.closed;
    }
    rematch(): void {
        if (this.room?.stage === 'Finished') this.send({ type: 'Rematch', round: this.room.round });
    }
    tick(seconds: number): void {
        if (this.closed || !Number.isFinite(seconds) || seconds < 0) return;
        this.idle += seconds; this.heartbeat += seconds;
        if (this.pending) this.pendingSeconds += seconds;
        if (this.idle >= lanSettings.timeoutSeconds || this.pendingSeconds >= lanSettings.timeoutSeconds && this.pending) {
            this.close('连接超时，本场已中止'); return;
        }
        if (this.room && this.heartbeat >= lanSettings.heartbeatSeconds) {
            this.heartbeat = 0; this.send({ type: 'Ping' });
        }
    }
    private send(message: ClientMessage | RemoteHello): void {
        if (this.closed) return;
        try { this.peer.send(JSON.stringify(message)); } catch { this.close('连接发送失败，本场已中止'); }
    }
    close(reason = '已退出房间'): void {
        if (this.closed) return;
        this.closed = true;
        try { this.peer.send(JSON.stringify({ type: 'Leave' })); } catch { /* 连接可能已关闭。 */ }
        this.peer.onClose = undefined; this.peer.onMessage = undefined; this.peer.close(); this.hooks.ended(reason);
    }
}
