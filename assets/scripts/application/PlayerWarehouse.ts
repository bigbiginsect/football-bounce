import type { LineupEditor, TeamSide } from './LineupEditor';
import type { PlayerCatalog } from '../core/PlayerCatalog';
import type { FormationId } from '../core/Lineup';
import { formationDefinitions, formationPositions } from '../core/Lineup';

export type WarehouseCommand =
    | { readonly type: 'SelectSlot'; readonly slot: number }
    | { readonly type: 'SelectFormation'; readonly formationId: FormationId }
    | { readonly type: 'DeployPlayer'; readonly templateId: string };

export interface WarehouseSnapshot {
    readonly side: TeamSide;
    readonly selectedSlot: number;
    readonly active: readonly string[];
    readonly players: readonly string[];
    readonly formationId: FormationId;
    readonly formations: readonly { readonly id: FormationId; readonly label: string }[];
    readonly slotPositions: readonly { readonly x: number; readonly y: number }[];
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
            formationId: draft.formationId,
            formations: formationDefinitions.map(formation => ({ id: formation.id, label: formation.label })),
            // 仓库的球场始终以本方从下向上进攻展示；真实红方坐标由 LineupEditor 镜像。
            slotPositions: formationPositions(draft.formationId, 'blue'),
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
        if (command.type === 'SelectFormation') {
            return this.lineups.execute(command);
        }
        if (!this.catalog.players.some(player => player.id === command.templateId)
            || snapshot.active.indexOf(command.templateId) >= 0) return false;
        return this.lineups.execute({ type: 'ReplaceFromBench', templateId: command.templateId,
            slot: snapshot.selectedSlot });
    }
}
