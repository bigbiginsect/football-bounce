import type { LanPeer } from '../../application/LanTransport';
import { lanSettings } from '../../core/LanProtocol';

interface NativeConnection {
    readonly readyState: number;
    send(data: string, callback?: (error?: string) => void): void;
    close(code?: number, reason?: string): void;
    onmessage: (data: unknown) => void;
    onclose: (error?: string) => void;
    onerror: (error?: string) => void;
}
interface NativeServer {
    listen(port: number, callback: (error?: string) => void): void;
    close(callback?: (error?: string) => void): void;
    onconnection: (connection: NativeConnection) => void;
    onclose: (error?: string) => void;
}
type NativeServerConstructor = new () => NativeServer;
function serverConstructor(): NativeServerConstructor | undefined {
    return (globalThis as typeof globalThis & { WebSocketServer?: NativeServerConstructor }).WebSocketServer;
}
export function canHostLan(): boolean { return typeof serverConstructor() === 'function'; }

/** Cocos 3.8.8 原生全局 WebSocketServer；Web端不假装创建成功。 */
export class LanSocketServer {
    private server?: NativeServer;
    private readonly peers = new Set<LanPeer>();
    private closed = false;
    constructor(private readonly port: number = lanSettings.port) {}
    async listen(accept: (peer: LanPeer) => void, failed: (reason: string) => void): Promise<void> {
        const Server = serverConstructor();
        if (!Server) throw new Error('此预览不能创建房间。请使用启用附近联机的 Android 版本。');
        const server = new Server(); this.server = server;
        server.onconnection = connection => {
            if (this.closed) { connection.close(); return; }
            const peer: LanPeer = {
                send: data => {
                    if (connection.readyState !== 1) throw new Error('连接已关闭');
                    connection.send(data, error => { if (error) { peer.onClose?.(); connection.close(); } });
                },
                close: () => { this.peers.delete(peer); connection.close(); },
            };
            connection.onmessage = data => peer.onMessage?.(data);
            connection.onclose = () => { this.peers.delete(peer); peer.onClose?.(); };
            connection.onerror = () => { peer.onClose?.(); connection.close(); };
            this.peers.add(peer); accept(peer);
        };
        server.onclose = () => { if (!this.closed) { this.close(); failed('房间服务已停止'); } };
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { this.close(); reject(new Error('创建房间超时，请重试')); }, lanSettings.handshakeSeconds * 1000);
            server.listen(this.port, error => {
                clearTimeout(timer);
                if (this.closed) { reject(new Error('房间已取消')); return; }
                if (error) { this.close(); reject(new Error(`创建房间失败，端口可能被占用：${error}`)); }
                else resolve();
            });
        });
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const peer of [...this.peers]) peer.close();
        this.peers.clear(); this.server?.close(); this.server = undefined;
    }
}

/** 限定输入IPv4与可选端口，避免把公网网址误当成附近房间。 */
export function lanAddress(input: string): string {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(input.trim());
    if (!match) throw new Error('请输入房主的 IPv4 地址，例如 192.168.43.1');
    const parts = match[1].split('.').map(Number);
    const port = match[2] ? Number(match[2]) : lanSettings.port;
    if (parts.some(x => x > 255) || parts[0] === 0 || parts[0] >= 224 || parts[3] === 255 || port < 1 || port > 65535)
        throw new Error('房主地址或端口无效，请查看 Wi-Fi 网络详情中的网关地址');
    return `ws://${parts.join('.')}:${port}`;
}
export interface LanConnectAttempt { readonly result: Promise<LanPeer>; cancel(): void }
export function connectLan(input: string): LanConnectAttempt {
    const socket = new WebSocket(lanAddress(input));
    let settled = false;
    let rejectPending: (error: Error) => void = () => {};
    let timer: ReturnType<typeof setTimeout>;
    const result = new Promise<LanPeer>((resolve, reject) => {
        rejectPending = reject;
        const fail = (): void => {
            if (settled) return;
            settled = true; clearTimeout(timer); socket.close(); reject(new Error('无法连接房主，请检查热点、地址和游戏版本'));
        };
        timer = setTimeout(fail, lanSettings.handshakeSeconds * 1000);
        socket.onerror = fail; socket.onclose = fail;
        socket.onopen = () => {
            if (settled) { socket.close(); return; }
            settled = true; clearTimeout(timer);
            const peer: LanPeer = {
                send: data => {
                    if (socket.readyState !== 1) throw new Error('连接已关闭');
                    if (socket.bufferedAmount > lanSettings.maxMessageLength * 2) throw new Error('网络拥塞');
                    socket.send(data);
                },
                close: () => socket.close(),
            };
            socket.onmessage = event => peer.onMessage?.(event.data);
            socket.onclose = () => peer.onClose?.();
            socket.onerror = () => { peer.onClose?.(); socket.close(); };
            resolve(peer);
        };
    });
    return { result, cancel: () => {
        if (!settled) { settled = true; clearTimeout(timer); rejectPending(new Error('已取消连接')); }
        socket.close();
    } };
}
