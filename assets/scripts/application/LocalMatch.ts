import type { Command } from '../core/Command';
import type { GameState } from '../core/GameState';
import { validateCommand, Rejection } from '../core/validateCommand';

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export type CommandResult = { readonly ok: true; readonly revision: number }
    | { readonly ok: false; readonly reason: Rejection };

/** 本地权威入口。初始状态由可信应用配置创建，不能直接传入网络载荷。 */
export class LocalMatch {
    private state: GameState;
    private readonly acceptedIds = new Set<string>();
    private readonly commands: Command[] = [];

    constructor(initialState: GameState) { this.state = copy(initialState); }

    getSnapshot(): GameState { return copy(this.state); }
    getAcceptedCommands(): readonly Command[] { return copy(this.commands); }

    execute(input: unknown, sessionOperatorId: string): CommandResult {
        const checked = validateCommand(this.state, input, sessionOperatorId, this.acceptedIds);
        if (!checked.ok) return checked;
        // 只记录协议字段，丢弃调用方额外载荷（含非 JSON 对象/自报比分）。
        const c = checked.command;
        const command: Command = {
            type: c.type, commandId: c.commandId, matchId: c.matchId,
            turnNumber: c.turnNumber, operatorId: c.operatorId, playerId: c.playerId,
            direction: { x: c.direction.x, y: c.direction.y }, power: c.power,
        };
        this.state = { ...this.state, revision: this.state.revision + 1, phase: 'Simulating' };
        this.acceptedIds.add(command.commandId);
        this.commands.push(command);
        return { ok: true, revision: this.state.revision };
    }
}
