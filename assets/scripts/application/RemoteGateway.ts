import type { PrototypeConfig } from '../core/PrototypeConfig';
import type { ConditionSession } from '../core/GameState';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import { isRoomCode, parseRemoteHello, remoteSettings } from '../core/RemoteProtocol';
import { lanSettings, lanSignature } from '../core/LanProtocol';
import { RemoteRoom } from './RemoteRoom';
import type { LanHostHooks } from './LanHost';
import type { LanPeer } from './LanTransport';

export interface RemoteGatewayOptions {
    readonly config: PrototypeConfig; readonly catalog: PlayerCatalog;
    readonly authenticate: (accessKey: string) => boolean;
    readonly roomCode: () => string; readonly roomId: () => string;
    readonly conditions: () => ConditionSession;
    readonly hooks: (code: string) => LanHostHooks;
    readonly maxRooms?: number; readonly maxConnections?: number;
}
/** 首包分配房间和身份；不依赖Node、socket或真实时钟。 */
export class RemoteGateway {
    private readonly rooms = new Map<string, RemoteRoom>();
    private readonly peers = new Map<LanPeer, { pending: boolean; idle: number; count: number; window: number }>();
    private closed = false;
    private readonly signature: string;
    constructor(private readonly options: RemoteGatewayOptions) { this.signature = lanSignature(options.config, options.catalog); }
    getStats() { return { rooms: this.rooms.size, connections: this.peers.size }; }
    attach(raw: LanPeer): void {
        if (this.closed || this.peers.size >= (this.options.maxConnections ?? remoteSettings.maxConnections)) {
            this.reject(raw, '服务连接已满或已关闭'); return;
        }
        const peer: LanPeer = { send: data => raw.send(data), close: () => {
            this.peers.delete(peer); raw.onMessage = undefined; raw.onClose = undefined; raw.close();
        } };
        const entry = { pending: true, idle: 0, count: 0, window: 0 }; this.peers.set(peer, entry);
        raw.onMessage = data => {
            if (!this.peers.has(peer)) return;
            if (++entry.count > remoteSettings.messagesPerSecond) {
                const onClose = peer.onClose; this.reject(peer, '消息过于频繁，连接已关闭'); onClose?.(); return;
            }
            if (entry.pending) this.handshake(peer, data); else peer.onMessage?.(data);
        };
        raw.onClose = () => { this.peers.delete(peer); peer.onClose?.(); };
    }
    private handshake(peer: LanPeer, data: unknown): void {
        const message = parseRemoteHello(data);
        if (!message) { this.reject(peer, '远程连接请求无效'); return; }
        if (!this.options.authenticate(message.accessKey)) { this.reject(peer, '连接口令错误'); return; }
        if (message.signature !== this.signature) { this.reject(peer, '游戏版本或配置不一致，请安装相同版本'); return; }
        const entry = this.peers.get(peer); if (!entry) return;
        entry.pending = false;
        if (message.action === 'Join') {
            const room = this.rooms.get(message.roomCode);
            if (!room || !room.attachRed(peer)) this.reject(peer, room ? '房间已满或已关闭' : '房间不存在，请检查房间码');
            return;
        }
        if (this.rooms.size >= (this.options.maxRooms ?? remoteSettings.maxRooms)) { this.reject(peer, '服务房间已满'); return; }
        let code = '';
        for (let i = 0; i < 32; i++) {
            const next = this.options.roomCode(); if (isRoomCode(next) && !this.rooms.has(next)) { code = next; break; }
        }
        if (!code) { this.reject(peer, '暂时无法分配房间码'); return; }
        const hooks = this.options.hooks(code);
        const room = new RemoteRoom(code, this.options.roomId(), this.options.config, this.options.catalog,
            this.options.conditions(), peer, { ...hooks, ended: reason => {
                this.rooms.delete(code); hooks.ended(reason);
            } });
        this.rooms.set(code, room); room.start();
    }
    tick(seconds: number): void {
        if (this.closed || !Number.isFinite(seconds) || seconds < 0) return;
        for (const [peer, entry] of this.peers) {
            entry.window += seconds;
            if (entry.window >= 1) { entry.window %= 1; entry.count = 0; }
            if (entry.pending && (entry.idle += seconds) >= lanSettings.handshakeSeconds) this.reject(peer, '连接握手超时');
        }
        for (const room of [...this.rooms.values()]) room.tick(seconds);
    }
    private reject(peer: LanPeer, reason: string): void {
        try { peer.send(JSON.stringify({ type: 'Ended', reason })); } catch { /* 对端可能已断开。 */ }
        peer.close();
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const room of [...this.rooms.values()]) room.close();
        for (const peer of [...this.peers.keys()]) this.reject(peer, '电脑服务已关闭');
        this.rooms.clear(); this.peers.clear();
    }
}
