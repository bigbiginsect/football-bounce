import type { ConditionSession } from '../core/GameState';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { RoomStatus, ServerMessage } from '../core/LanProtocol';
import { lanSettings, parseClientMessage } from '../core/LanProtocol';
import { LanHost, LanHostHooks } from './LanHost';
import type { LanPeer } from './LanTransport';

/** 电脑房间复用附近权威流程，给蓝方增加真实连接；两方都不能接触物理/写状态。 */
export class RemoteRoom {
    private readonly host: LanHost;
    private red?: LanPeer;
    private closed = false;
    private blueIdle = 0;
    constructor(readonly code: string, roomId: string, config: PrototypeConfig, private readonly catalog: PlayerCatalog,
        conditions: ConditionSession, private readonly blue: LanPeer, hooks: LanHostHooks) {
        this.host = new LanHost(roomId, config, catalog, conditions, {
            createMatch: (...args) => hooks.createMatch(...args), ballAngle: () => hooks.ballAngle(),
            roomChanged: room => {
                this.sendBlue({ type: 'Lobby', room: this.decorate(room) }); hooks.roomChanged(this.decorate(room));
            },
            ended: reason => { this.close(reason); hooks.ended(reason); },
        });
        blue.onMessage = data => this.receiveBlue(data);
        blue.onClose = () => this.close('蓝队已断开，本场已中止');
    }
    /** Gateway先登记房间再发送欢迎，发送失败也能释放登记资源。 */
    start(): void {
        this.sendBlue({ type: 'Welcome', side: 'blue', signature: this.host.signature,
            conditions: this.host.conditions, room: this.getRoom() });
    }
    getRoom(): RoomStatus { return this.decorate(this.host.getRoom()); }
    private decorate(room: RoomStatus): RoomStatus { return { ...room, kind: 'Remote', code: this.code }; }
    attachRed(peer: LanPeer): boolean {
        if (this.closed || this.red) return false;
        this.red = peer;
        const proxy: LanPeer = {
            send: data => {
                const message = JSON.parse(data) as ServerMessage;
                if (message.type === 'Welcome' || message.type === 'Lobby') peer.send(JSON.stringify({ ...message, room: this.decorate(message.room) }));
                else peer.send(data);
                if (message.type === 'Snapshot') this.sendBlue(message);
            },
            close: () => peer.close(),
        };
        peer.onMessage = data => { if (!this.closed) proxy.onMessage?.(data); };
        peer.onClose = () => proxy.onClose?.();
        this.host.attach(proxy);
        // Gateway已校验远程首包；内部沿用LanHost握手，后续身份仍只绑定红连接。
        proxy.onMessage?.(JSON.stringify({ type: 'Hello', signature: this.host.signature }));
        return !this.closed;
    }
    private receiveBlue(data: unknown): void {
        if (this.closed) return;
        const message = parseClientMessage(data, this.catalog);
        if (!message) { this.sendBlue({ type: 'Rejected', commandId: '', reason: '消息格式无效' }); return; }
        this.blueIdle = 0;
        switch (message.type) {
        case 'Ping': this.sendBlue({ type: 'Pong' }); break;
        case 'Ready':
            if (message.round !== this.getRoom().round || !this.host.readyBlue(message.selection))
                this.sendBlue({ type: 'Rejected', commandId: '', reason: '阵容已过期或比赛已开始' });
            break;
        case 'Launch': {
            const result = this.host.executeBlue(message.command);
            if (!result.ok) this.sendBlue({ type: 'Rejected', commandId: message.command.commandId, reason: result.reason });
            break;
        }
        case 'Rematch': if (message.round === this.getRoom().round) this.host.rematch(); break;
        case 'Leave': this.close('蓝队已退出房间，本场已中止'); break;
        case 'Hello': this.sendBlue({ type: 'Rejected', commandId: '', reason: '连接已完成握手' }); break;
        }
    }
    tick(seconds: number): void {
        if (this.closed || !Number.isFinite(seconds) || seconds < 0) return;
        this.blueIdle += seconds;
        if (this.blueIdle >= lanSettings.timeoutSeconds) { this.close('蓝队连接超时，本场已中止'); return; }
        this.host.tick(seconds);
    }
    private sendBlue(message: ServerMessage): void {
        if (this.closed) return;
        try { this.blue.send(JSON.stringify(message)); } catch { this.close('蓝队连接发送失败，本场已中止'); }
    }
    close(reason = '电脑服务已关闭，本场已中止'): void {
        if (this.closed) return;
        this.closed = true;
        this.blue.onClose = undefined; this.blue.onMessage = undefined;
        try { this.blue.send(JSON.stringify({ type: 'Ended', reason })); } catch { /* 连接可能已断开。 */ }
        this.host.close(reason); // 同时通知红方并触发Gateway的唯一清理回调。
        this.blue.close();
        if (this.red) { this.red.onClose = undefined; this.red.onMessage = undefined; }
    }
}
