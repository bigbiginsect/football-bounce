import type { LineupEditor, TeamSide } from './LineupEditor';
import type { PlayerCatalog } from '../core/PlayerCatalog';

export type WarehouseCommand =
    | { readonly type: 'SelectSlot'; readonly slot: number }
    | { readonly type: 'DeployPlayer'; readonly templateId: string };

export interface WarehouseSnapshot {
    readonly side: TeamSide;
    readonly selectedSlot: number;
    readonly active: readonly string[];
    readonly players: readonly string[];
}

/** 球员仓库应用入口；最终阵容修改仍交给 LineupEditor 校验和执行。 */
export class PlayerWarehouse {
    private readonly selectedSlots: Record<TeamSide, number> = { blue: 0, red: 0 };

    constructor(private readonly catalog: PlayerCatalog, private readonly lineups: LineupEditor) {}

    getSnapshot(): WarehouseSnapshot {
        const draft = this.lineups.getSnapshot();
        return {
            side: draft.side,
            selectedSlot: this.selectedSlots[draft.side],
            active: [...draft[draft.side]],
            players: this.catalog.players.map(player => player.id),
        };
    }

    execute(command: WarehouseCommand): boolean {
        const snapshot = this.getSnapshot();
        if (command.type === 'SelectSlot') {
            if (!Number.isInteger(command.slot) || command.slot < 0 || command.slot >= snapshot.active.length) {
                return false;
            }
            this.selectedSlots[snapshot.side] = command.slot;
            return true;
        }
        if (!this.catalog.players.some(player => player.id === command.templateId)
            || snapshot.active.indexOf(command.templateId) >= 0) return false;
        return this.lineups.execute({ type: 'ReplaceFromBench', templateId: command.templateId,
            slot: snapshot.selectedSlot });
    }
}
