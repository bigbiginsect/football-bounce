import type { Node } from 'cc';
import type { Command } from '../core/Command';
import type { ConditionSession, GameState } from '../core/GameState';
import type { MatchLineups } from '../core/Lineup';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { PrototypeConfig } from '../core/PrototypeConfig';
import type { LanSide, RoomStatus, SimulationStatus, TeamSelection } from '../core/LanProtocol';
import { LanHost } from '../application/LanHost';
import { LanClient } from '../application/LanClient';
import type { LocalMatch, CommandResult } from '../application/LocalMatch';
import { connectLan, connectRemote, LanConnectAttempt, LanSocketServer } from '../adapters/network/LanSocket';
import { isRoomCode, RemoteRequest } from '../core/RemoteProtocol';
import { LanMenuView } from './LanMenuView';

interface LanControllerHooks {
    local(): void;
    choose(side: LanSide, conditions: ConditionSession): void;
    clear(): void;
    createMatch(lineups: MatchLineups, matchId: string, conditions: ConditionSession): LocalMatch;
    snapshot(state: GameState, status: SimulationStatus, ballAngle: number): void;
    rejected(reason: string): void;
    ballAngle(): number;
}

/** 菜单、房间生命周期的组合层；比赛规则仍全部交给应用层。 */
export class LanController {
    private menu?: LanMenuView;
    private host?: LanHost;
    private client?: LanClient;
    private server?: LanSocketServer;
    private attempt?: LanConnectAttempt;
    private room?: RoomStatus;
    private roomConditions: ConditionSession;
    private choosing = false;
    private generation = 0;
    private closing = false;
    private disposed = false;
    get isNetwork(): boolean { return Boolean(this.host || this.client || this.attempt || this.server); }
    get side(): LanSide | undefined { return this.host ? 'blue' : this.client?.side; }

    constructor(private readonly parent: Node, private readonly config: PrototypeConfig,
        private readonly catalog: PlayerCatalog, private readonly localConditions: ConditionSession,
        private readonly hooks: LanControllerHooks) { this.roomConditions = localConditions; }
    openMenu(message = ''): void {
        if (this.disposed) return;
        this.cleanup(); this.hooks.clear(); this.menu?.dispose();
        this.menu = new LanMenuView(this.parent, {
            local: () => { this.menu?.dispose(); this.menu = undefined; this.hooks.local(); },
            host: () => { void this.createRoom(); }, join: address => { void this.joinRoom(address); },
            remote: () => this.openRemote(),
        }, message);
    }
    private openRemote(): void {
        if (this.isNetwork) return;
        this.menu?.dispose(); this.menu = new LanMenuView(this.parent);
        this.menu.showRemote({
            create: (address, key) => this.requestRemote(address, key, 'Create', ''),
            join: (address, key, code) => this.requestRemote(address, key, 'Join', code.toUpperCase().trim()),
            back: () => this.openMenu(),
        });
    }
    private requestRemote(address: string, key: string, action: 'Create' | 'Join', code: string): void {
        if (!/^[\x21-\x7e]{12,128}$/.test(key)) { this.menu?.setMessage('请输入电脑显示的12—128位连接口令'); return; }
        if (action === 'Join' && !isRoomCode(code)) { this.menu?.setMessage('请输入6位字母数字房间码'); return; }
        void this.joinRoom(address, { action, accessKey: key, roomCode: code });
    }
    private async createRoom(): Promise<void> {
        if (this.isNetwork) return;
        const token = ++this.generation;
        this.menu?.setBusy('正在创建附近房间…'); this.roomConditions = this.localConditions;
        this.host = new LanHost(`lan-${Date.now()}-${token}`, this.config, this.catalog, this.roomConditions, {
            createMatch: (lineups, id, conditions) => this.hooks.createMatch(lineups, id, conditions),
            roomChanged: room => this.roomChanged(room), ended: reason => this.end(reason),
            ballAngle: () => this.hooks.ballAngle(),
        });
        const server = new LanSocketServer(); this.server = server;
        try {
            await server.listen(peer => this.host?.attach(peer), reason => this.end(reason));
            if (this.disposed || token !== this.generation) { server.close(); return; }
            this.roomChanged(this.host!.getRoom());
        } catch (error) {
            if (!this.disposed && token === this.generation) this.openMenu(String(error instanceof Error ? error.message : error));
        }
    }
    private async joinRoom(address: string, remote?: RemoteRequest): Promise<void> {
        if (this.isNetwork) return;
        const token = ++this.generation;
        try {
            if (remote?.action === 'Join' && !isRoomCode(remote.roomCode)) throw new Error('请输入6位字母数字房间码');
            this.menu?.setBusy(remote ? '正在连接电脑服务…' : '正在连接房主…');
            this.attempt = remote ? connectRemote(address) : connectLan(address);
            const peer = await this.attempt.result;
            if (this.disposed || token !== this.generation) { peer.close(); return; }
            this.attempt = undefined;
            this.client = new LanClient(peer, this.config, this.catalog, {
                welcomed: conditions => { this.roomConditions = conditions; },
                roomChanged: room => this.roomChanged(room), snapshot: (state, status, angle) => this.hooks.snapshot(state, status, angle),
                rejected: reason => this.hooks.rejected(reason), ended: reason => this.end(reason),
            }, remote);
            this.client.start();
        } catch (error) {
            if (!this.disposed && token === this.generation) this.openMenu(error instanceof Error ? error.message : String(error));
        }
    }
    private roomChanged(room: RoomStatus): void {
        if (this.closing || this.disposed) return;
        const newRound = this.room?.round !== room.round;
        this.room = room;
        if (room.stage === 'Selecting') {
            if (newRound) { this.choosing = false; this.hooks.clear(); }
            if (!this.choosing) this.showRoom();
        } else { this.choosing = false; this.menu?.dispose(); this.menu = undefined; }
    }
    private showRoom(): void {
        if (!this.room || !this.side) return;
        this.menu?.dispose();
        this.menu = new LanMenuView(this.parent);
        this.menu.showRoom(this.room, this.side, () => {
            this.choosing = true; this.menu?.dispose(); this.menu = undefined;
            this.hooks.choose(this.side!, this.roomConditions);
        }, () => this.end('已退出房间'));
    }
    ready(selection: TeamSelection): void {
        this.choosing = false;
        if (this.host) this.host.readyBlue(selection); else this.client?.ready(selection);
        if (this.room?.stage === 'Selecting') this.showRoom();
    }
    launch(command: Command): CommandResult {
        if (this.host) return this.host.executeBlue(command);
        return this.client?.launch(command) ? { ok: true, revision: 0 } : { ok: false, reason: 'WrongPhase' };
    }
    rematch(): void { if (this.host) this.host.rematch(); else this.client?.rematch(); }
    tick(seconds: number): void { this.host?.tick(seconds); this.client?.tick(seconds); }
    interrupt(): void { if (this.isNetwork) this.end('游戏切到后台，房间已关闭，请重新连接'); }
    private end(reason: string): void { if (!this.closing && !this.disposed) this.openMenu(reason); }
    private cleanup(): void {
        this.closing = true; this.generation++;
        this.host?.close(); this.host = undefined;
        this.client?.close(); this.client = undefined;
        this.attempt?.cancel(); this.attempt = undefined;
        this.server?.close(); this.server = undefined;
        this.room = undefined; this.choosing = false; this.closing = false;
    }
    dispose(): void { this.disposed = true; this.cleanup(); this.menu?.dispose(); this.menu = undefined; }
}
