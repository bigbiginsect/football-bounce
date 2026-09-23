import type { PrototypeConfig } from './PrototypeConfig';
import type { Vector2Data } from './GameState';

export interface BoundaryWall {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** 墙体坐标使用米；球门侧壁从门线向外延伸，不能侵入场内形成挡球台阶。 */
export function createBoundaryWalls(c: PrototypeConfig): BoundaryWall[] {
    const walls: BoundaryWall[] = [
        { x: -c.fieldWidth / 2 - c.wallThickness / 2, y: 0,
            width: c.wallThickness, height: c.fieldHeight + 2 * c.wallThickness },
        { x: c.fieldWidth / 2 + c.wallThickness / 2, y: 0,
            width: c.wallThickness, height: c.fieldHeight + 2 * c.wallThickness },
    ];
    const endSegment = (c.fieldWidth - c.goalWidth) / 2;
    for (const side of [-1, 1]) {
        const x = side * (c.goalWidth / 2 + endSegment / 2);
        for (const end of [-1, 1]) {
            walls.push({ x, y: end * (c.fieldHeight + c.wallThickness) / 2,
                width: endSegment, height: c.wallThickness });
        }
    }
    for (const end of [-1, 1]) {
        const lineY = end * c.fieldHeight / 2;
        const goalY = lineY + end * (c.goalDepth + c.wallThickness) / 2;
        for (const side of [-1, 1]) {
            walls.push({ x: side * (c.goalWidth + c.wallThickness) / 2, y: goalY,
                width: c.wallThickness, height: c.goalDepth + c.wallThickness });
        }
        walls.push({ x: 0, y: lineY + end * (c.goalDepth + c.wallThickness / 2),
            width: c.goalWidth + 2 * c.wallThickness, height: c.wallThickness });
    }
    return walls;
}

/** 圆形物体可沿门柱角的圆弧通行；仅用球场和球门两个缩小矩形会误判该区域。 */
export function isPlayablePosition(position: Vector2Data, radius: number, c: PrototypeConfig): boolean {
    const tolerance = 0.04;
    const x = Math.abs(position.x);
    const y = Math.abs(position.y);
    const halfField = c.fieldHeight / 2;
    const halfGoal = c.goalWidth / 2;
    const withinPitch = x <= c.fieldWidth / 2 - radius + tolerance
        && y <= halfField - radius + tolerance;
    const withinGoal = x <= halfGoal - radius + tolerance
        && y >= halfField - radius - tolerance
        && y <= halfField + c.goalDepth - radius + tolerance;
    // 门柱角 (halfGoal, halfField) 之外的四分之一圆区域，物体不会与端线墙或侧壁相交。
    const aroundPost = x <= halfGoal && y <= halfField
        && Math.hypot(halfGoal - x, halfField - y) >= radius - tolerance;
    return withinPitch || withinGoal || aroundPost;
}
