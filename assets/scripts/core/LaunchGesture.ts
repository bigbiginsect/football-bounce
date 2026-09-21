import type { Vector2Data } from './GameState';
import type { PrototypeConfig } from './PrototypeConfig';

export function mapDrag(start: Vector2Data, current: Vector2Data, config: PrototypeConfig) {
    const x = start.x - current.x; const y = start.y - current.y;
    const distance = Math.hypot(x, y);
    if (!Number.isFinite(distance) || distance <= config.dragDeadZone) return null;
    return { direction: { x: x / distance, y: y / distance },
        power: Math.min(1, (distance - config.dragDeadZone) / (config.fullPowerDrag - config.dragDeadZone)) };
}

/** 仅拥有首个有效触点；其他触点的移动、取消、松手都不能干扰它。 */
export class LaunchGesture {
    private active: { id: number; playerId: string; start: Vector2Data; current: Vector2Data } | null = null;
    constructor(private readonly config: PrototypeConfig) {}
    begin(id: number, playerId: string, point: Vector2Data): boolean {
        if (this.active) return false;
        this.active = { id, playerId, start: { ...point }, current: { ...point } }; return true;
    }
    move(id: number, point: Vector2Data): void {
        if (this.active?.id === id) this.active.current = { ...point };
    }
    preview() {
        if (!this.active) return null;
        return { playerId: this.active.playerId, aim: mapDrag(this.active.start, this.active.current, this.config) };
    }
    end(id: number, point: Vector2Data) {
        if (this.active?.id !== id) return null;
        this.move(id, point); const result = this.preview(); this.cancel(); return result;
    }
    cancel(id?: number): void { if (id === undefined || this.active?.id === id) this.active = null; }
}
