import type { GameState } from '../core/GameState';

export type MatchSide = 'blue' | 'red';
export type MatchFeedbackEvent =
    | { readonly type: 'goal'; readonly scorer: MatchSide; readonly score: Readonly<Record<MatchSide, number>> }
    | { readonly type: 'turn-timeout'; readonly expiredSide: MatchSide; readonly activeSide: MatchSide }
    | { readonly type: 'finished'; readonly winner: MatchSide | null;
        readonly score: Readonly<Record<MatchSide, number>> };

export interface MatchOverlay {
    readonly type: 'goal' | 'turn-timeout';
    readonly title: string;
    readonly detail: string;
}

type ObservedState = {
    readonly matchId: string;
    readonly turnNumber: number;
    readonly phase: GameState['phase'];
    readonly activeSide: MatchSide;
    readonly score: Readonly<Record<MatchSide, number>>;
};

function side(value: string): MatchSide {
    if (value === 'blue' || value === 'red') return value;
    throw new Error(`不支持的本地比赛阵营：${value}`);
}

function observed(state: GameState): ObservedState {
    return {
        matchId: state.matchId,
        turnNumber: state.turnNumber,
        phase: state.phase,
        activeSide: side(state.activeOperatorId),
        score: { blue: state.score.blue ?? 0, red: state.score.red ?? 0 },
    };
}

export function sideLabel(value: MatchSide): string { return value === 'blue' ? '蓝方' : '红方'; }

export function matchClock(milliseconds: number): string {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const remainder = seconds % 60;
    return `${Math.floor(seconds / 60)}:${remainder < 10 ? `0${remainder}` : remainder}`;
}

export function overlayFor(event: MatchFeedbackEvent): MatchOverlay | null {
    if (event.type === 'goal') return {
        type: 'goal',
        title: `${sideLabel(event.scorer)}进球！`,
        detail: `蓝 ${event.score.blue}  :  ${event.score.red} 红`,
    };
    if (event.type === 'turn-timeout') return {
        type: 'turn-timeout',
        title: `${sideLabel(event.expiredSide)}瞄准超时`,
        detail: `轮到${sideLabel(event.activeSide)}行动`,
    };
    return null;
}

/** 将权威状态的离散变化转换为一次性表现事件，不持有或改写 GameState。 */
export class MatchFeedbackTracker {
    private previous?: ObservedState;

    reset(state?: GameState): void { this.previous = state ? observed(state) : undefined; }

    observe(state: GameState, reason: string): readonly MatchFeedbackEvent[] {
        const current = observed(state);
        if (!this.previous || this.previous.matchId !== current.matchId) {
            this.previous = current;
            return [];
        }
        const previous = this.previous;
        const events: MatchFeedbackEvent[] = [];
        for (const scorer of ['blue', 'red'] as const) {
            if (current.score[scorer] > previous.score[scorer]) {
                events.push({ type: 'goal', scorer, score: { ...current.score } });
            }
        }
        if (reason === 'turn-timeout' && current.turnNumber !== previous.turnNumber) {
            events.push({ type: 'turn-timeout', expiredSide: previous.activeSide,
                activeSide: current.activeSide });
        }
        if (current.phase === 'Finished' && previous.phase !== 'Finished') {
            events.push({ type: 'finished', winner: state.result?.winnerId === null ? null
                : side(state.result?.winnerId ?? ''), score: { ...current.score } });
        }
        this.previous = current;
        return events;
    }
}
