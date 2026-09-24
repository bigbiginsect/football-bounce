import { Node, RigidBody2D, CircleCollider2D, BoxCollider2D, ERigidBody2DType,
    PhysicsSystem2D, Vec2, PHYSICS_2D_PTM_RATIO, Contact2DType, IPhysics2DContact } from 'cc';
import type { Command } from '../../core/Command';
import type { BodyState, GameState } from '../../core/GameState';
import type { PhysicsPort, PhysicsFrame } from '../../core/PhysicsPort';
import type { PrototypeConfig } from '../../core/PrototypeConfig';
import { detectGoal } from '../../core/PrototypeConfig';
import { releaseWallContact } from '../../core/WallContact';
import { createBoundaryWalls } from '../../core/BoundaryGeometry';
import { getPlayerTemplate, playerGameplayValues, PlayerCatalog } from '../../core/PlayerCatalog';

/** 物理根节点不参与 UI 缩放。位置为引擎单位，速度/冲量按 Box2D 的 SI 单位。 */
export class CocosPhysics implements PhysicsPort {
    private readonly root = new Node('PrototypePhysics');
    private readonly bodies = new Map<string, RigidBody2D>();
    private readonly impulses = new Map<string, number>();
    private readonly system = PhysicsSystem2D.instance;
    private strongestImpact = 0;
    private readonly previous = { auto: this.system.autoSimulation, gravity: this.system.gravity.clone(),
        enabled: this.system.enable, mask: this.system.collisionMatrix[1] };

    constructor(scene: Node, private readonly config: PrototypeConfig, state: GameState,
        catalog: PlayerCatalog) {
        if (state.catalogVersion !== catalog.version) throw new Error('比赛球员目录版本不匹配');
        if (PhysicsSystem2D.PHYSICS_NONE || PhysicsSystem2D.PHYSICS_BUILTIN) {
            throw new Error('请在项目设置中启用 Box2D 物理模块');
        }
        scene.addChild(this.root);
        this.system.enable = true; this.system.autoSimulation = false;
        this.system.gravity = new Vec2(0, 0);
        // 原型所有球员、球及墙使用 DEFAULT=1，同组相互碰撞。
        this.system.collisionMatrix[1] = 1;
        const c = config;
        for (const wall of createBoundaryWalls(c)) this.wall(wall.x, wall.y, wall.width, wall.height);
        for (const player of state.players) {
            const values = playerGameplayValues(getPlayerTemplate(catalog, player.templateId), config);
            this.circle(player.instanceId, player, false, values.mass);
            this.impulses.set(player.instanceId, values.maxImpulse);
        }
        this.circle('ball', state.ball, true, config.ballMass);
        this.restore(state);
    }

    private wall(x: number, y: number, width: number, height: number): void {
        const node = new Node('Boundary'); node.active = false; this.root.addChild(node);
        node.setPosition(x * PHYSICS_2D_PTM_RATIO, y * PHYSICS_2D_PTM_RATIO);
        const body = node.addComponent(RigidBody2D); body.type = ERigidBody2DType.Static; body.group = 1;
        const collider = node.addComponent(BoxCollider2D);
        collider.size.set(width * PHYSICS_2D_PTM_RATIO, height * PHYSICS_2D_PTM_RATIO);
        collider.friction = this.config.friction; collider.restitution = this.config.wallRestitution;
        node.active = true;
    }

    private circle(id: string, state: BodyState, ball: boolean, mass: number): void {
        const c = this.config; const radius = ball ? c.ballRadius : c.playerRadius;
        const node = new Node(id); node.active = false; this.root.addChild(node);
        node.setPosition(state.position.x * PHYSICS_2D_PTM_RATIO, state.position.y * PHYSICS_2D_PTM_RATIO);
        const body = node.addComponent(RigidBody2D);
        body.type = ERigidBody2DType.Dynamic; body.group = 1; body.bullet = true;
        body.fixedRotation = !ball; body.gravityScale = 0;
        if (ball) body.angularDamping = c.ballAngularDamping;
        body.linearDamping = ball ? c.ballDamping : c.playerDamping;
        const collider = node.addComponent(CircleCollider2D);
        collider.radius = radius * PHYSICS_2D_PTM_RATIO;
        collider.density = mass / (Math.PI * radius * radius);
        collider.friction = c.friction; collider.restitution = ball ? c.ballRestitution : c.playerRestitution;
        collider.on(Contact2DType.POST_SOLVE, this.recordImpact, this);
        node.active = true; this.bodies.set(id, body);
    }

    private recordImpact(contact: IPhysics2DContact): void {
        const impulse = contact.getImpulse();
        if (!impulse) return;
        for (const value of impulse.normalImpulses) {
            if (Number.isFinite(value)) this.strongestImpact = Math.max(this.strongestImpact, Math.abs(value));
        }
    }

    /** 只供本地音效消费；每次读取后清零，不能作为规则或联网事实。 */
    consumeStrongestImpact(): number {
        const value = this.strongestImpact;
        this.strongestImpact = 0;
        return value;
    }

    restore(state: GameState): void {
        this.strongestImpact = 0;
        for (const [id, data] of [...state.players.map(p => [p.instanceId, p] as const), ['ball', state.ball] as const]) {
            const body = this.bodies.get(id)!;
            body.node.setPosition(data.position.x * PHYSICS_2D_PTM_RATIO, data.position.y * PHYSICS_2D_PTM_RATIO);
            body.linearVelocity = new Vec2(data.velocity.x, data.velocity.y); body.angularVelocity = 0;
            if (id === 'ball') body.linearDamping = this.config.ballDamping;
            body.wakeUp();
        }
        this.system.physicsWorld.syncSceneToPhysics();
    }
    launch(command: Command): void {
        const impulse = command.power * (this.impulses.get(command.playerId) ?? this.config.maxImpulse);
        this.bodies.get(command.playerId)!.applyLinearImpulseToCenter(
            new Vec2(command.direction.x * impulse, command.direction.y * impulse), true);
        this.limitSpeeds();
    }
    private limitSpeeds(): void {
        for (const body of this.bodies.values()) {
            const velocity = body.linearVelocity; const speed = velocity.length();
            if (speed > this.config.maxSpeed) body.linearVelocity = velocity.clone().multiplyScalar(this.config.maxSpeed / speed);
        }
    }
    step(seconds: number): void {
        const ball = this.bodies.get('ball')!;
        const speed = ball.linearVelocity.length();
        ball.linearDamping = speed < this.config.stopSpeed * this.config.ballLowSpeedMultiplier
            ? this.config.ballLowSpeedDamping : this.config.ballDamping;
        this.system.physicsWorld.syncSceneToPhysics();
        this.system.step(seconds); this.limitSpeeds();
        this.system.physicsWorld.syncPhysicsToScene();
        for (const [id, body] of this.bodies) {
            const position = releaseWallContact({
                position: { x: body.node.position.x / PHYSICS_2D_PTM_RATIO, y: body.node.position.y / PHYSICS_2D_PTM_RATIO },
                velocity: body.linearVelocity,
            }, id === 'ball' ? this.config.ballRadius : this.config.playerRadius, this.config);
            if (position) body.node.setPosition(position.x * PHYSICS_2D_PTM_RATIO, position.y * PHYSICS_2D_PTM_RATIO);
        }
        // 必须先同步分离结果，再采样回写权威状态；下一步不能继续使用旧接触位置。
        this.system.physicsWorld.syncSceneToPhysics();
    }
    sample(): PhysicsFrame {
        const read = (body: RigidBody2D): BodyState => ({
            position: { x: body.node.position.x / PHYSICS_2D_PTM_RATIO, y: body.node.position.y / PHYSICS_2D_PTM_RATIO },
            velocity: { x: body.linearVelocity.x, y: body.linearVelocity.y },
        });
        const ball = read(this.bodies.get('ball')!);
        const goal = detectGoal({ ball }, this.config);
        return { players: [...this.bodies].filter(([id]) => id !== 'ball').map(([instanceId, body]) => ({ instanceId, ...read(body) })),
            ball, goal: goal === 'blue' ? 'top' : goal === 'red' ? 'bottom' : null };
    }
    /** 仅供本地球面图案显示；角度尚未进入跨设备权威状态。 */
    getBallAngle(): number { return this.bodies.get('ball')!.node.angle; }
    stop(): void {
        this.strongestImpact = 0;
        for (const body of this.bodies.values()) { body.linearVelocity = new Vec2(); body.angularVelocity = 0; }
    }
    dispose(): void {
        this.stop(); this.root.active = false; this.root.destroy(); this.bodies.clear(); this.impulses.clear();
        this.system.autoSimulation = this.previous.auto; this.system.gravity = this.previous.gravity;
        this.system.enable = this.previous.enabled; this.system.collisionMatrix[1] = this.previous.mask;
        this.system.resetAccumulator();
    }
}
