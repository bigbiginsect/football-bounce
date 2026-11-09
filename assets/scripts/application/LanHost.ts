import type { Command } from '../core/Command';
import type { ConditionSession } from '../core/GameState';
import type { MatchLineups } from '../core/Lineup';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import { cloneLan, lanSettings, lanSignature, parseClientMessage, parseSelection, selectionLineup } from '../core/LanProtocol';
import type { RoomStatus, ServerMessage, TeamSelection } from '../core/LanProtocol';
import type { LocalMatch, CommandResult } from './LocalMatch';
import type { LanPeer } from './LanTransport';

export interface LanHostHooks {
    createMatch(lineups: MatchLineups, matchId: string, conditions: ConditionSession): LocalMatch;
    roomChanged(room: RoomStatus): void;
    ended(reason: string): void;
    ballAngle(): number;
}

/** 连接绑定红方身份；只有本类及 LocalMatch 能推进权威比赛。时间由组合层注入。 */
export class LanHost {
    private peer?: LanPeer;
    private welcomed = false;
    private closed = false;
    private idle = 0;
    private snapshotTime = 0;
    private round = 1;
    private stage: RoomStatus['stage'] = 'Selecting';
    private blue?: TeamSelection;
    private red?: TeamSelection;
    private match?: LocalMatch;
    readonly signature: string;

    constructor(readonly roomId: string, config: PrototypeConfig, private readonly catalog: PlayerCatalog,
        readonly conditions: ConditionSession, private readonly hooks: LanHostHooks) {
        this.signature = lanSignature(config, catalog);
    }
    getRoom(): RoomStatus { return { roomId: this.roomId, round: this.round, stage: this.stage,
        connected: this.welcomed, blueReady: Boolean(this.blue), redReady: Boolean(this.red) }; }
    attach(peer: LanPeer): void {
        if (this.closed || this.peer) {
            try { peer.send(JSON.stringify({ type: 'Ended', reason: '房间已满或已关闭' })); } finally { peer.close(); }
            return;
        }
        this.peer = peer; this.idle = 0;
        peer.onMessage = data => { if (this.peer === peer && !this.closed) this.receive(data); };
        peer.onClose = () => {
            if (this.peer !== peer || this.closed) return;
            if (this.welcomed) this.close('对方已断开，本场已中止');
            else this.dropPending();
        };
    }
    private receive(data: unknown): void {
        const message = parseClientMessage(data, this.catalog);
        if (!message) { this.reject('消息格式无效'); return; }
        if (!this.welcomed) {
            if (message.type !== 'Hello' || message.signature !== this.signature) {
                this.send({ type: 'Ended', reason: '游戏版本或配置不一致，请安装相同版本' });
                this.dropPending(); return;
            }
            this.welcomed = true; this.idle = 0;
            this.send({ type: 'Welcome', signature: this.signature, conditions: this.conditions, side: 'red', room: this.getRoom() });
            this.notifyRoom(); return;
        }
        this.idle = 0;
        switch (message.type) {
        case 'Ping': this.send({ type: 'Pong' }); break;
        case 'Ready':
            if (message.round !== this.round || this.stage !== 'Selecting') { this.reject('阵容已过期或比赛已开始'); break; }
            this.red = message.selection; this.notifyRoom(); this.tryStart(); break;
        case 'Launch': {
            // 永远从连接分配红方会话身份，不能从载荷 operatorId 取身份。
            const result = this.execute(message.command, 'red');
            if (!result.ok) this.reject(result.reason, message.command.commandId);
            break;
        }
        case 'Rematch': if (message.round === this.round) this.rematch(); break;
        case 'Leave': this.close('对方已退出房间，本场已中止'); break;
        case 'Hello': this.reject('连接已完成握手'); break;
        }
    }
    readyBlue(input: TeamSelection): boolean {
        const selection = parseSelection(input, this.catalog);
        if (this.closed || this.stage !== 'Selecting' || !selection) return false;
        this.blue = selection; this.notifyRoom(); this.tryStart(); return true;
    }
    private tryStart(): void {
        if (!this.welcomed || !this.blue || !this.red || this.closed) return;
        try {
            this.match = this.hooks.createMatch({ blue: selectionLineup(this.blue, 'blue'),
                red: selectionLineup(this.red, 'red') }, `${this.roomId}-${this.round}`, cloneLan(this.conditions));
            this.stage = 'Playing'; this.notifyRoom(); this.publish();
        } catch { this.close('创建比赛失败，请重新创建房间'); }
    }
    executeBlue(command: Command): CommandResult { return this.execute(command, 'blue'); }
    private execute(command: Command, side: 'blue' | 'red'): CommandResult {
        if (this.closed || this.stage !== 'Playing' || !this.match) return { ok: false, reason: 'WrongPhase' };
        const result = this.match.execute(command, side);
        if (result.ok) this.publish();
        return result;
    }
    rematch(): void {
        if (this.closed || this.stage !== 'Finished') return;
        this.round++; this.stage = 'Selecting'; this.blue = undefined; this.red = undefined; this.match = undefined;
        this.notifyRoom();
    }
    tick(seconds: number): void {
        if (this.closed || !Number.isFinite(seconds) || seconds < 0) return;
        if (this.peer) {
            this.idle += seconds;
            if (this.idle >= lanSettings.timeoutSeconds) {
                if (this.welcomed) this.close('连接超时，本场已中止'); else this.dropPending();
                return;
            }
        }
        if (!this.match || this.stage !== 'Playing') return;
        const before = this.match.getSnapshot();
        this.match.advance(seconds); this.snapshotTime += seconds;
        const after = this.match.getSnapshot();
        if (after.phase === 'Finished') {
            this.stage = 'Finished'; this.notifyRoom(); this.publish();
        } else if (after.turnNumber !== before.turnNumber || after.phase !== before.phase
            || this.snapshotTime >= lanSettings.snapshotSeconds) this.publish();
    }
    private publish(): void {
        if (!this.match) return;
        this.snapshotTime = 0;
        this.send({ type: 'Snapshot', round: this.round, state: this.match.getSnapshot(),
            status: this.match.getSimulationStatus(), ballAngle: this.hooks.ballAngle() });
    }
    private notifyRoom(): void {
        const room = this.getRoom(); this.send({ type: 'Lobby', room });
        if (!this.closed) this.hooks.roomChanged(room);
    }
    private reject(reason: string, commandId = ''): void { this.send({ type: 'Rejected', reason, commandId }); }
    private send(message: ServerMessage): void {
        if (!this.welcomed && (message.type === 'Lobby' || message.type === 'Snapshot')) return;
        try { this.peer?.send(JSON.stringify(message)); }
        catch { this.close('连接发送失败，本场已中止'); }
    }
    private dropPending(): void {
        const peer = this.peer; this.peer = undefined; this.welcomed = false; this.idle = 0;
        if (peer) { peer.onClose = undefined; peer.onMessage = undefined; peer.close(); }
    }
    close(reason = '房主已退出房间，本场已中止'): void {
        if (this.closed) return;
        this.closed = true;
        try { this.peer?.send(JSON.stringify({ type: 'Ended', reason })); } catch { /* 对端可能已断开。 */ }
        this.dropPending(); this.hooks.ended(reason);
    }
}
