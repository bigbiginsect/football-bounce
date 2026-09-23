import type { MatchLineups } from '../core/Lineup';
import { defaultLineups, validateLineups } from '../core/Lineup';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { PrototypeConfig } from '../core/PrototypeConfig';

export type TeamSide = 'blue' | 'red';
export type LineupEdit =
    | { readonly type: 'ReplaceFromBench'; readonly templateId: string; readonly slot: number }
    | { readonly type: 'SwapSlots'; readonly from: number; readonly to: number }
    | { readonly type: 'ConfirmSide' }
    | { readonly type: 'BackToBlue' };

export interface LineupDraftSnapshot {
    readonly side: TeamSide;
    readonly blue: readonly string[];
    readonly red: readonly string[];
    readonly bench: readonly string[];
    readonly ready: boolean;
}

/** 赛前阵容的唯一写入口。槽位保存模板 ID，固定坐标始终来自默认站位。 */
export class LineupEditor {
    private side: TeamSide = 'blue';
    private ready = false;
    private readonly teams: Record<TeamSide, string[]>;

    constructor(private readonly catalog: PlayerCatalog, private readonly config: PrototypeConfig,
        previous: MatchLineups = defaultLineups()) {
        const checked = validateLineups(previous, catalog, config);
        this.teams = {
            blue: checked.blue.map(item => item.templateId),
            red: checked.red.map(item => item.templateId),
        };
    }

    getSnapshot(): LineupDraftSnapshot {
        const selected = new Set(this.teams[this.side]);
        return {
            side: this.side, blue: [...this.teams.blue], red: [...this.teams.red],
            bench: this.catalog.players.filter(player => !selected.has(player.id)).map(player => player.id),
            ready: this.ready,
        };
    }

    execute(edit: LineupEdit): boolean {
        if (this.ready) return false;
        const team = this.teams[this.side];
        switch (edit.type) {
        case 'ReplaceFromBench': {
            if (!this.validSlot(edit.slot) || !this.catalog.players.some(player => player.id === edit.templateId)
                || team.indexOf(edit.templateId) >= 0) return false;
            team[edit.slot] = edit.templateId;
            return true;
        }
        case 'SwapSlots': {
            if (!this.validSlot(edit.from) || !this.validSlot(edit.to) || edit.from === edit.to) return false;
            [team[edit.from], team[edit.to]] = [team[edit.to], team[edit.from]];
            return true;
        }
        case 'ConfirmSide':
            if (this.side === 'blue') this.side = 'red';
            else this.ready = true;
            return true;
        case 'BackToBlue':
            if (this.side !== 'red') return false;
            this.side = 'blue'; return true;
        }
    }

    toMatchLineups(): MatchLineups {
        if (!this.ready) throw new Error('双方尚未确认阵容');
        const positions = defaultLineups();
        return validateLineups({
            blue: this.teams.blue.map((templateId, slot) => ({ templateId, position: positions.blue[slot].position })),
            red: this.teams.red.map((templateId, slot) => ({ templateId, position: positions.red[slot].position })),
        }, this.catalog, this.config);
    }

    private validSlot(index: number): boolean { return Number.isInteger(index) && index >= 0 && index < 5; }
}
