import { decodeLan, record } from './LanProtocol';

export interface RemoteHello {
    readonly type: 'RemoteHello'; readonly signature: string; readonly accessKey: string;
    readonly action: 'Create' | 'Join'; readonly roomCode: string;
}
export interface RemoteRequest { readonly action: 'Create' | 'Join'; readonly roomCode: string; readonly accessKey: string }
export const remoteSettings = Object.freeze({ port: 8766, maxRooms: 4, maxConnections: 16, messagesPerSecond: 40 });
export function isRoomCode(value: unknown): value is string { return typeof value === 'string' && /^[A-Z0-9]{6}$/.test(value); }
export function parseRemoteHello(data: unknown): RemoteHello | null {
    const v = decodeLan(data);
    if (!v || v.type !== 'RemoteHello' || typeof v.signature !== 'string' || v.signature.length > 160
        || typeof v.accessKey !== 'string' || v.accessKey.length < 12 || v.accessKey.length > 128
        || (v.action !== 'Create' && v.action !== 'Join') || typeof v.roomCode !== 'string'
        || (v.action === 'Join' ? !isRoomCode(v.roomCode) : v.roomCode !== '')) return null;
    return { type: 'RemoteHello', signature: v.signature, accessKey: v.accessKey, action: v.action, roomCode: v.roomCode };
}
export function validRemoteRoom(value: unknown): boolean {
    return record(value) && value.kind === 'Remote' && isRoomCode(value.code);
}
