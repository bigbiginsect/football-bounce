/** 消息边界；应用层不依赖 WebSocket、引擎、真实时间或 Node。 */
export interface LanPeer {
    send(data: string): void;
    close(): void;
    onMessage?: (data: unknown) => void;
    onClose?: () => void;
}
