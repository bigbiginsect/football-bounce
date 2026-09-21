const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePath = process.env.CREATOR_BOX2D_MODULE_PATH;
if (!modulePath) throw new Error('请设置 CREATOR_BOX2D_MODULE_PATH，指向当前 Creator 自带的 @cocos/box2d 目录');
const b2 = require(modulePath);
const { prototypeConfig: config } = require('../.test-output/core/PrototypeConfig.js');
const { releaseWallContact } = require('../.test-output/core/WallContact.js');

// 使用真实 Box2D 求解器；只依赖外部指定的已安装引擎，不将本机路径写进共享配置。
function simulate({ release = true, axis = 'x', sign = 1, offset = 0, corner = false, impulse = true }) {
  const world = new b2.World(new b2.Vec2(0, 0));
  function wall(x, y, width, height) {
    const body = world.CreateBody(new b2.BodyDef());
    const shape = new b2.PolygonShape(); shape.SetAsBox(width / 2, height / 2, new b2.Vec2(x, y), 0);
    const f = new b2.FixtureDef(); f.shape = shape; f.friction = config.friction; f.restitution = config.wallRestitution;
    body.CreateFixture(f);
  }
  const w = config.fieldWidth, h = config.fieldHeight, t = config.wallThickness;
  wall(-w/2-t/2, 0, t, h+2*t); wall(w/2+t/2, 0, t, h+2*t);
  wall(0, -h/2-t/2, w, t); wall(0, h/2+t/2, w, t);
  const bodies = [];
  function circle(x, y, radius, mass, damping, restitution) {
    const d = new b2.BodyDef(); d.type = b2.BodyType.b2_dynamicBody; d.position.Set(x, y);
    d.fixedRotation = true; d.bullet = true; d.linearDamping = damping;
    const body = world.CreateBody(d); const f = new b2.FixtureDef();
    f.shape = new b2.CircleShape(radius); f.density = mass / (Math.PI * radius * radius);
    f.friction = config.friction; f.restitution = restitution; body.CreateFixture(f);
    bodies.push({ body, radius }); return body;
  }
  const extent = (axis === 'x' ? w : h) / 2;
  const transform = (normal, tangent) => axis === 'x' ? [sign * normal, tangent] : [tangent, sign * normal];
  const targetPosition = corner ? [w/2-config.ballRadius, h/2-config.ballRadius] : transform(extent-config.ballRadius, 0);
  const playerPosition = corner ? [w/2-1.6, h/2-1.6] : transform(extent-1.6, offset);
  const ball = circle(...targetPosition, config.ballRadius, config.ballMass, config.ballDamping, config.ballRestitution);
  const player = circle(...playerPosition, config.playerRadius, config.playerMass, config.playerDamping, config.playerRestitution);
  function step() {
    world.Step(config.fixedStep, 10, 10);
    for (const { body, radius } of bodies) {
      const velocity = body.GetLinearVelocity(); const speed = Math.hypot(velocity.x, velocity.y);
      if (speed > config.maxSpeed) body.SetLinearVelocity(new b2.Vec2(velocity.x * config.maxSpeed/speed, velocity.y * config.maxSpeed/speed));
      if (release) {
        const p = releaseWallContact({ position: body.GetPosition(), velocity: body.GetLinearVelocity() }, radius, config);
        if (p) body.SetTransformVec(new b2.Vec2(p.x, p.y), 0);
      }
    }
  }
  for (let i=0; i<60; i++) step();
  const settled = { x: ball.GetPosition().x, y: ball.GetPosition().y };
  if (impulse) {
    const vector = corner ? [config.maxImpulse/Math.SQRT2, config.maxImpulse/Math.SQRT2] : transform(config.maxImpulse, 0);
    player.ApplyLinearImpulse(new b2.Vec2(...vector), player.GetPosition(), true);
  }
  let maxClearance = 0;
  for (let i=0; i<180; i++) {
    step(); const p = ball.GetPosition();
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(Math.abs(p.x) < w/2 && Math.abs(p.y) < h/2, '不得越界');
    const clearance = corner ? Math.min(w/2-config.ballRadius-p.x, h/2-config.ballRadius-p.y)
      : extent-config.ballRadius-sign*p[axis];
    maxClearance = Math.max(maxClearance, clearance);
  }
  return { maxClearance, settled, position: { x: ball.GetPosition().x, y: ball.GetPosition().y }, speed: ball.GetLinearVelocity().Length() };
}
for (const offset of [0, 0.15]) test(`旧行为对照：贴墙球偏移 ${offset} 受撞后仍贴墙`, () => {
  const result = simulate({ release: false, offset });
  assert.ok(result.maxClearance < 0.04, JSON.stringify(result));
});
for (const axis of ['x','y']) for (const sign of [-1,1]) for (const offset of [0,0.15]) {
  test(`真实 Box2D：${axis} ${sign} 墙，偏移 ${offset}，受撞后离墙`, () => {
    const result = simulate({ axis, sign, offset });
    assert.ok(result.maxClearance > 0.2, JSON.stringify(result));
  });
}
test('真实 Box2D：角落中的球受斜向撞击后离开两面墙', () => {
  const result = simulate({ corner: true });
  assert.ok(result.maxClearance > 0.2, JSON.stringify(result));
});
test('真实 Box2D：无人撞击时只分离一次，球不自行弹起或漂移', () => {
  const result = simulate({ impulse: false });
  assert.equal(result.position.x, result.settled.x); assert.equal(result.position.y, result.settled.y);
  assert.equal(result.speed, 0);
});
