import type { Command } from '../../core/Command';
import type { BodyState, GameState, Vector2Data } from '../../core/GameState';
import type { PhysicsFrame, PhysicsPort } from '../../core/PhysicsPort';
import type { PrototypeConfig } from '../../core/PrototypeConfig';
import { detectGoal } from '../../core/PrototypeConfig';
import { createBoundaryWalls, createCornerBumpers } from '../../core/BoundaryGeometry';
import { releaseWallContact } from '../../core/WallContact';
import { getPlayerTemplate, playerGameplayValues, PlayerCatalog } from '../../core/PlayerCatalog';

interface BoxBody {
    CreateFixture(definition: BoxFixtureDefinition): unknown;
    GetPosition(): Vector2Data; GetLinearVelocity(): Vector2Data; GetAngle(): number;
    SetLinearVelocity(value: Vector2Data): void; SetAngularVelocity(value: number): void;
    SetLinearDamping(value: number): void; SetTransformVec(position: Vector2Data, angle: number): void;
    SetAwake(value: boolean): void; SetUserData(value: string): void; GetUserData(): unknown;
    ApplyLinearImpulse(value: Vector2Data, center: Vector2Data, awake: boolean): void;
    GetWorldCenter(): Vector2Data;
}
interface BoxBodyDefinition {
    type: number; position: { Set(x: number, y: number): void };
    fixedRotation: boolean; bullet: boolean; linearDamping: number; angularDamping: number;
}
interface BoxFixtureDefinition { shape: unknown; density: number; friction: number; restitution: number }
interface BoxContact { GetFixtureA(): { GetBody(): BoxBody }; GetFixtureB(): { GetBody(): BoxBody } }
interface BoxWorld {
    CreateBody(definition: BoxBodyDefinition): BoxBody; DestroyBody(body: BoxBody): void;
    Step(seconds: number, velocityIterations: number, positionIterations: number): void;
    SetContactListener(listener: { BeginContact(contact: BoxContact): void }): void;
}
/** 仅描述使用到的Box2D API；库由电脑入口注入，不把Node依赖打进手机。 */
export interface Box2DModule {
    World: new (gravity: Vector2Data) => BoxWorld;
    Vec2: new (x: number, y: number) => Vector2Data;
    BodyDef: new () => BoxBodyDefinition;
    FixtureDef: new () => BoxFixtureDefinition;
    PolygonShape: new () => { SetAsBox(hx: number, hy: number, center: Vector2Data, angle: number): void };
    CircleShape: new (radius: number) => unknown;
    ContactListener: new () => { BeginContact(contact: BoxContact): void };
    BodyType: { b2_dynamicBody: number };
}

/** 电脑唯一模拟器。米/米每秒及配置与Cocos适配器相同，不承诺不同求解器逐帧一致。 */
export class Box2DPhysics implements PhysicsPort {
    private readonly world: BoxWorld;
    private readonly bodies = new Map<string, BoxBody>();
    private readonly allBodies: BoxBody[] = [];
    private readonly impulses = new Map<string, number>();
    private readonly contacts = new Set<string>();
    private disposed = false;
    constructor(private readonly b2: Box2DModule, private readonly config: PrototypeConfig,
        state: GameState, catalog: PlayerCatalog) {
        if (state.catalogVersion !== catalog.version) throw new Error('服务端球员目录不匹配');
        this.world = new b2.World(new b2.Vec2(0, 0));
        const listener = new b2.ContactListener();
        listener.BeginContact = contact => {
            const a = contact.GetFixtureA().GetBody().GetUserData();
            const b = contact.GetFixtureB().GetBody().GetUserData();
            const playerId = a === 'ball' ? b : b === 'ball' ? a : null;
            if (typeof playerId === 'string' && playerId !== 'ball' && this.bodies.has(playerId)) this.contacts.add(playerId);
        };
        this.world.SetContactListener(listener);
        for (const wall of createBoundaryWalls(config)) {
            const body = this.createBody();
            const shape = new b2.PolygonShape();
            shape.SetAsBox(wall.width / 2, wall.height / 2, new b2.Vec2(wall.x, wall.y), 0);
            this.fixture(body, shape, 0, config.friction, config.wallRestitution);
        }
        for (const bumper of createCornerBumpers(config)) {
            const def = new b2.BodyDef(); def.position.Set(bumper.x, bumper.y);
            this.fixture(this.createBody(def), new b2.CircleShape(bumper.radius), 0,
                config.cornerBumperFriction, config.cornerBumperRestitution);
        }
        for (const player of state.players) {
            const values = playerGameplayValues(getPlayerTemplate(catalog, player.templateId), config);
            this.circle(player.instanceId, player, config.playerRadius, values.mass, config.playerDamping, config.playerRestitution);
            this.impulses.set(player.instanceId, values.maxImpulse);
        }
        this.circle('ball', state.ball, config.ballRadius, config.ballMass, config.ballDamping, config.ballRestitution);
        this.restore(state);
    }
    private createBody(definition = new this.b2.BodyDef()): BoxBody {
        const body = this.world.CreateBody(definition); this.allBodies.push(body); return body;
    }
    private fixture(body: BoxBody, shape: unknown, density: number, friction: number, restitution: number): void {
        const def = new this.b2.FixtureDef();
        def.shape = shape; def.density = density; def.friction = friction; def.restitution = restitution; body.CreateFixture(def);
    }
    private circle(id: string, state: BodyState, radius: number, mass: number, damping: number, restitution: number): void {
        const def = new this.b2.BodyDef(); def.type = this.b2.BodyType.b2_dynamicBody;
        def.position.Set(state.position.x, state.position.y); def.fixedRotation = id !== 'ball';
        def.bullet = true; def.linearDamping = damping; def.angularDamping = this.config.ballAngularDamping;
        const body = this.createBody(def); body.SetUserData(id);
        this.fixture(body, new this.b2.CircleShape(radius), mass / (Math.PI * radius * radius), this.config.friction, restitution);
        this.bodies.set(id, body);
    }
    restore(state: GameState): void {
        this.contacts.clear();
        for (const [id, data] of [...state.players.map(p => [p.instanceId, p] as const), ['ball', state.ball] as const]) {
            const body = this.bodies.get(id); if (!body) throw new Error('缺少服务端物理实例');
            body.SetTransformVec(new this.b2.Vec2(data.position.x, data.position.y), body.GetAngle());
            body.SetLinearVelocity(new this.b2.Vec2(data.velocity.x, data.velocity.y));
            body.SetAngularVelocity(0); body.SetAwake(true);
        }
    }
    launch(command: Command, multiplier = 1): void {
        const body = this.bodies.get(command.playerId); if (!body) throw new Error('球员不存在');
        const impulse = command.power * multiplier * (this.impulses.get(command.playerId) ?? this.config.maxImpulse);
        body.ApplyLinearImpulse(new this.b2.Vec2(command.direction.x * impulse, command.direction.y * impulse), body.GetWorldCenter(), true);
        this.limitSpeeds();
    }
    private limitSpeeds(): void {
        for (const body of this.bodies.values()) {
            const v = body.GetLinearVelocity(); const speed = Math.hypot(v.x, v.y);
            if (speed > this.config.maxSpeed) body.SetLinearVelocity(new this.b2.Vec2(v.x * this.config.maxSpeed / speed, v.y * this.config.maxSpeed / speed));
        }
    }
    step(seconds: number): void {
        if (this.disposed) throw new Error('物理已释放');
        const ball = this.bodies.get('ball')!; const speed = Math.hypot(ball.GetLinearVelocity().x, ball.GetLinearVelocity().y);
        ball.SetLinearDamping(speed < this.config.stopSpeed * this.config.ballLowSpeedMultiplier
            ? this.config.ballLowSpeedDamping : this.config.ballDamping);
        this.world.Step(seconds, 10, 10); this.limitSpeeds();
        for (const [id, body] of this.bodies) {
            const position = releaseWallContact({ position: body.GetPosition(), velocity: body.GetLinearVelocity() },
                id === 'ball' ? this.config.ballRadius : this.config.playerRadius, this.config);
            if (position) body.SetTransformVec(new this.b2.Vec2(position.x, position.y), body.GetAngle());
        }
    }
    sample(): PhysicsFrame {
        // Box2D向量的x/y可能是原型访问器，不能通过对象展开转换成JSON。
        const read = (body: BoxBody): BodyState => {
            const p = body.GetPosition(), v = body.GetLinearVelocity();
            return { position: { x: p.x, y: p.y }, velocity: { x: v.x, y: v.y } };
        };
        const ball = read(this.bodies.get('ball')!); const scorer = detectGoal({ ball }, this.config);
        const ballPlayerContacts = [...this.contacts]; this.contacts.clear();
        return { ball, players: [...this.bodies].filter(([id]) => id !== 'ball').map(([instanceId, body]) => ({ instanceId, ...read(body) })),
            ballPlayerContacts, goal: scorer === 'blue' ? 'top' : scorer === 'red' ? 'bottom' : null };
    }
    getBallAngle(): number { return this.bodies.get('ball')!.GetAngle() * 180 / Math.PI; }
    stop(): void { this.contacts.clear(); for (const body of this.bodies.values()) {
        body.SetLinearVelocity(new this.b2.Vec2(0, 0)); body.SetAngularVelocity(0);
    } }
    dispose(): void {
        if (this.disposed) return;
        this.stop(); this.disposed = true;
        for (const body of this.allBodies) this.world.DestroyBody(body);
        this.allBodies.length = 0; this.bodies.clear(); this.impulses.clear();
    }
}
