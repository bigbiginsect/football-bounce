import type { GameState, PlayerState, Vector2Data } from './GameState';

export const AIM_WOBBLE_SKILL = 'aim-wobble';
export const BALL_HIT_ENCORE_SKILL = 'ball-hit-encore';

export function skillNumber(player: PlayerState, skillId: string, key: string, fallback: number): number {
    if (player.skill?.id !== skillId) return fallback;
    const value = player.skill.params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function aimWobbleDegrees(state: GameState): number {
    const effect = state.skills.aimWobble;
    if (!effect || state.phase !== 'Aiming' || effect.targetOperatorId !== state.activeOperatorId) return 0;
    const elapsedSeconds = Math.max(0,
        state.clock.turnDurationMs - state.clock.turnRemainingMs) / 1000;
    return Math.sin(effect.phaseRadians + elapsedSeconds * effect.frequencyHz * Math.PI * 2)
        * effect.amplitudeDegrees;
}

/** 表现层和权威执行层共用同一方向修正，避免瞄准线与真实发射方向不一致。 */
export function effectiveAimDirection(state: GameState, direction: Vector2Data): Vector2Data {
    const radians = aimWobbleDegrees(state) * Math.PI / 180;
    if (Math.abs(radians) <= 1e-12) return { x: direction.x, y: direction.y };
    const cos = Math.cos(radians); const sin = Math.sin(radians);
    const x = direction.x * cos - direction.y * sin;
    const y = direction.x * sin + direction.y * cos;
    const length = Math.hypot(x, y);
    return length > 0 ? { x: x / length, y: y / length } : { x: direction.x, y: direction.y };
}
