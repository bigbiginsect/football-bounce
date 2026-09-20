import { Command, isCommand } from './Command';
import type { GameState } from './GameState';

export type Rejection = 'InvalidCommand' | 'IdentityMismatch' | 'WrongMatch'
    | 'DuplicateCommand' | 'WrongTurn' | 'WrongPhase' | 'WrongOperator' | 'WrongPlayer';

export function validateCommand(
    state: GameState, input: unknown, sessionOperatorId: string,
    acceptedIds: ReadonlySet<string>,
): { readonly ok: true; readonly command: Command } | { readonly ok: false; readonly reason: Rejection } {
    const reject = (reason: Rejection) => ({ ok: false as const, reason });
    if (!isCommand(input)) return reject('InvalidCommand');
    if (input.operatorId !== sessionOperatorId) return reject('IdentityMismatch');
    if (input.matchId !== state.matchId) return reject('WrongMatch');
    if (acceptedIds.has(input.commandId)) return reject('DuplicateCommand');
    if (input.turnNumber !== state.turnNumber) return reject('WrongTurn');
    if (state.phase !== 'Aiming') return reject('WrongPhase');
    if (state.activeOperatorId !== sessionOperatorId) return reject('WrongOperator');
    if (!state.players.some(p => p.instanceId === input.playerId && p.ownerId === sessionOperatorId)) {
        return reject('WrongPlayer');
    }
    return { ok: true, command: input };
}
