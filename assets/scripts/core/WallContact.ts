import type { BodyState, Vector2Data } from './GameState';
import type { PrototypeConfig } from './PrototypeConfig';

/**
 * 持续接触墙的静止球会被同时求解的墙/球员接触夹住，弹性不保证能释放。
 * 只在接触带内且法向近似静止时分离少量位置，不注入速度，不覆盖真正越界/非法状态。
 * 圆与圆的重叠仍由下一固定步的 Box2D 求解，不改变物体之间的碰撞规则。
 */
export function releaseWallContact(body: BodyState, radius: number, config: PrototypeConfig): Vector2Data | null {
    const { position, velocity } = body;
    if (![position.x, position.y, velocity.x, velocity.y].every(Number.isFinite)) return null;
    const release = (coordinate: number, speed: number, extent: number): number => {
        const limit = extent / 2 - radius;
        const distance = limit - Math.abs(coordinate);
        if (Math.abs(speed) > config.stopSpeed || Math.abs(distance) > config.wallContactTolerance) return coordinate;
        return Math.sign(coordinate) * (limit - config.wallReleaseGap);
    };
    const x = release(position.x, velocity.x, config.fieldWidth);
    // 球门口没有端线墙；进入球门通道时不能被阶段 1 的贴墙释放逻辑推回场内。
    const inGoalOpening = Math.abs(position.x) + radius <= config.goalWidth / 2 + config.wallContactTolerance;
    const y = inGoalOpening ? position.y : release(position.y, velocity.y, config.fieldHeight);
    return x === position.x && y === position.y ? null : { x, y };
}
