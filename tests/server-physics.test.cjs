const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Box2DPhysics } = require('../.test-output/adapters/physics/Box2DPhysics.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } = require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog, createPlayerConditions, getPlayerTemplate, playerGameplayValues } = require('../.test-output/core/PlayerCatalog.js');
const { validSnapshot } = require('../.test-output/core/LanProtocol.js');
let b2;
try { b2 = require(process.env.CREATOR_BOX2D_MODULE_PATH || '../server/node_modules/@cocos/box2d'); } catch { /* 环境缺少依赖时明确跳过。 */ }
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json')), config = freezeConfig(prototypeConfig);
function state() { return createStandardMatchState('physics', config, 5, catalog, undefined, createPlayerConditions(catalog, 5)); }
function setup(t) {
    if (!b2) { t.skip('需要server依赖@cocos/box2d，或通过CREATOR_BOX2D_MODULE_PATH复用Creator安装'); return; }
    const s = state(), physics = new Box2DPhysics(b2, config, s, catalog);
    t.after(() => physics.dispose()); return { s, physics };
}
test('电脑真实Box2D按球员质量/力量发射，快照仅含JSON且速度受上限约束', t => {
    const f = setup(t); if (!f) return; const { s, physics } = f;
    const player = s.players[0], values = playerGameplayValues(getPlayerTemplate(catalog, player.templateId), config);
    physics.launch({ playerId: player.instanceId, direction: { x: 0, y: 1 }, power: 0.3 });
    let frame = physics.sample();
    // 引擎包的向量内部使用Float32，验证物理关系时保留相应数值容差。
    assert.ok(Math.abs(frame.players[0].velocity.y - values.maxImpulse * 0.3 / values.mass) < 1e-6);
    physics.launch({ playerId: player.instanceId, direction: { x: 1, y: 0 }, power: 1 }, 100);
    frame = physics.sample(); assert.ok(Math.hypot(frame.players[0].velocity.x, frame.players[0].velocity.y) <= config.maxSpeed + 1e-8);
    assert.deepEqual(JSON.parse(JSON.stringify(frame)), frame);
});
test('电脑真实Box2D球员撞球、报告接触，门线通道与进球复位经LocalMatch结算', t => {
    const f = setup(t); if (!f) return;
    const s = f.s, player = s.players.find(p => p.ownerId === s.activeOperatorId);
    const placed = { ...s, players: s.players.map(p => p === player ? { ...p, position: { x: 0, y: -1 } } : p),
        kickoff: { ...s.kickoff, pending: false } };
    const match = new LocalMatch(placed, f.physics, config);
    assert.equal(match.execute({ type: 'Launch', matchId: s.matchId, commandId: 'strike', turnNumber: 1,
        operatorId: s.activeOperatorId, playerId: player.instanceId, direction: { x: 0, y: 1 }, power: 1 }, s.activeOperatorId).ok, true);
    let ballMoved = false;
    for (let i = 0; i < 900 && match.getSnapshot().phase === 'Simulating'; i++) {
        match.advance(config.fixedStep); const current = match.getSnapshot();
        ballMoved ||= Math.abs(current.ball.position.y) > 0.1;
        assert.equal(validSnapshot(current, config, catalog), true);
    }
    assert.equal(ballMoved, true); assert.notEqual(match.getSimulationStatus().reason, 'invalid');
    const nearGoal = { ...s, kickoff: { ...s.kickoff, pending: false },
        ball: { position: { x: 0, y: config.fieldHeight / 2 - 0.3 }, velocity: { x: 0, y: 5 } } };
    const goalMatch = new LocalMatch({ ...nearGoal, phase: 'Simulating' }, f.physics, config);
    for (let i = 0; i < 30 && goalMatch.getSnapshot().phase === 'Simulating'; i++) goalMatch.advance(config.fixedStep);
    assert.equal(goalMatch.getSnapshot().score.blue, 1);
    assert.equal(goalMatch.getSimulationStatus().reason, 'goal');
    assert.deepEqual(goalMatch.getSnapshot().ball.position, { x: 0, y: 0 });
    assert.equal(goalMatch.getSnapshot().activeOperatorId, 'red');
});
test('电脑真实Box2D接触实例供技能规则使用，静止与恢复/释放无旧速度', t => {
    const f = setup(t); if (!f) return;
    const s = f.s; const p = s.players[0];
    f.physics.restore({ ...s, players: s.players.map(item => item === p ? { ...item, position: { x: 0, y: -0.6 }, velocity: { x: 0, y: 2 } } : item) });
    const contacts = new Set();
    for (let i = 0; i < 40; i++) { f.physics.step(config.fixedStep); for (const id of f.physics.sample().ballPlayerContacts) contacts.add(id); }
    assert.ok(contacts.has(p.instanceId));
    f.physics.stop(); assert.ok(f.physics.sample().players.every(p => p.velocity.x === 0 && p.velocity.y === 0));
    f.physics.restore(s); assert.deepEqual(f.physics.sample().ball, s.ball);
    f.physics.dispose(); f.physics.dispose(); assert.throws(() => f.physics.step(config.fixedStep), /释放/);
});
