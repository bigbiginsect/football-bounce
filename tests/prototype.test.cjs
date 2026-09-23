const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createPrototypeState } = require('../.test-output/core/PrototypeConfig.js');
const { mapDrag, LaunchGesture } = require('../.test-output/core/LaunchGesture.js');
const { releaseWallContact } = require('../.test-output/core/WallContact.js');
const clone = value => structuredClone(value);
const config = freezeConfig(prototypeConfig);
const command = (state, overrides = {}) => {
  const operatorId = state.activeOperatorId;
  const playerId = state.players.find(player => player.ownerId === operatorId).instanceId;
  return { type: 'Launch', commandId: `c${state.turnNumber}`, matchId: state.matchId,
    turnNumber: state.turnNumber, operatorId, playerId, direction: { x: 0, y: 1 }, power: 1, ...overrides };
};
class FakePhysics {
  launches = []; steps = []; stops = 0; onStep = () => {};
  restore(state) { this.frame = clone({ players: state.players, ball: state.ball }); }
  launch(input) { this.launches.push(clone(input)); }
  step(dt) { this.steps.push(dt); this.onStep(this.frame, this.steps.length); }
  sample() { return { ...clone(this.frame), goal: null }; }
  stop() { this.stops++; }
}
function setup(overrides = {}, fixture = 'normal', id = 'practice') {
  const c = freezeConfig({ ...config, ...overrides }); const state = createPrototypeState(id, c, fixture);
  const physics = new FakePhysics(); const match = new LocalMatch(state, physics, c);
  return { c, state, physics, match, launch: () => {
    const current = match.getSnapshot(); return match.execute(command(current), current.activeOperatorId);
  } };
}
function steps(match, count, dt = config.fixedStep) { for (let i = 0; i < count; i++) match.advance(dt); }

test('反向拖动：四方向、斜向、死区、满力度与超长拖动', () => {
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]]) {
    const aim = mapDrag({ x: 0, y: 0 }, { x, y }, config);
    assert.ok(Math.abs(aim.direction.x + x / Math.hypot(x, y)) < 1e-9);
    assert.ok(Math.abs(aim.direction.y + y / Math.hypot(x, y)) < 1e-9);
    assert.ok(aim.power > 0 && aim.power <= 1);
  }
  for (const x of [0, config.dragDeadZone, NaN, Infinity]) assert.equal(mapDrag({ x: 0, y: 0 }, { x, y: 0 }, config), null);
  assert.ok(mapDrag({ x: 0, y: 0 }, { x: config.dragDeadZone + 1e-6, y: 0 }, config).power > 0);
  for (const x of [config.fullPowerDrag, 100]) assert.equal(mapDrag({ x: 0, y: 0 }, { x, y: 0 }, config).power, 1);
  assert.ok(Math.abs(mapDrag({ x: 0, y: 0 }, { x: (config.fullPowerDrag + config.dragDeadZone) / 2, y: 0 }, config).power - 0.5) < 1e-9);
});
test('第二触点不能接管、移动、取消或结束首个触点，重复松手只产生一次意图', () => {
  const g = new LaunchGesture(config); const origin = { x: 0, y: 0 }; const end = { x: 1, y: 0 };
  assert.equal(g.begin(1, 'a1', origin), true); assert.equal(g.begin(2, 'a2', end), false);
  g.move(2, end); assert.equal(g.preview().aim, null); g.cancel(2); assert.equal(g.end(2, end), null);
  g.move(1, end); assert.ok(g.end(1, end).aim); assert.equal(g.end(1, end), null);
  g.begin(3, 'a1', origin); g.cancel(); assert.equal(g.preview(), null); assert.equal(g.end(3, end), null);
  assert.equal(g.begin(4, 'a1', origin), true); g.cancel(4); assert.equal(g.preview(), null);
});
test('配置冻结副本，非法参数阻止启动', () => {
  const original = { ...config }; const frozen = freezeConfig(original); original.playerMass = 99;
  assert.equal(frozen.playerMass, 2); assert.ok(Object.isFrozen(frozen));
  for (const patch of [{ playerMass: 0 }, { ballMass: NaN }, { maxImpulse: Infinity }, { friction: -1 },
    { wallRestitution: 1.1 }, { maxSubSteps: 1.5 }, { fixedStep: 1 }, { version: '' },
    { fullPowerDrag: 0.1, dragDeadZone: 0.2 }, { fieldWidth: 7 }, { stopSpeed: '0.04' },
    { wallReleaseGap: 0.02, wallContactTolerance: 0.03 }, { aimDashGap: 0 },
    { powerCircleOpacity: 1 }, { playerRadius: 0.4, powerCircleMaxRadius: 0.4 },
    { ballAngularDamping: -1 },
    { ballLowSpeedDamping: NaN }, { ballLowSpeedMultiplier: 0.5 }]) {
    assert.throws(() => freezeConfig({ ...config, ...patch }));
  }
  assert.throws(() => freezeConfig(null));
});
test('四种夹具 ID 唯一、无重叠，最大允许半径也合法', () => {
  for (const fixture of ['normal', 'dense', 'wall', 'corner']) {
    const c = freezeConfig({ ...config, playerRadius: 0.4, ballRadius: 0.2 });
    const state = createPrototypeState('fixture', c, fixture);
    assert.equal(new Set(state.players.map(p => p.instanceId)).size, state.players.length);
    const bodies = [...state.players.map(p => ({ ...p, radius: c.playerRadius })), { ...state.ball, radius: c.ballRadius }];
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      assert.ok(Math.hypot(bodies[i].position.x - bodies[j].position.x, bodies[i].position.y - bodies[j].position.y) > bodies[i].radius + bodies[j].radius);
    }
  }
});
test('拒绝命令不触发物理；一次接受仅发射一次', () => {
  const { match, physics, state } = setup();
  for (const [patch, identity] of [[{ playerId: 'b1' }, 'a'], [{ turnNumber: 2 }, 'a'], [{ power: 0 }, 'a'], [{}, 'b']]) {
    assert.equal(match.execute(command(state, patch), identity).ok, false);
  }
  assert.equal(physics.launches.length, 0); assert.equal(match.execute(command(state), 'a').ok, true);
  assert.equal(match.execute(command(state), 'a').reason, 'DuplicateCommand');
  assert.equal(match.execute(command(state, { commandId: 'new' }), 'a').reason, 'WrongPhase');
  assert.equal(physics.launches.length, 1);
});
test('连续静止恰好 18 步后完成 Resolving → Aiming，并可再次操作', () => {
  const { match, physics, launch } = setup(); launch(); steps(match, 17);
  assert.equal(match.getSnapshot().phase, 'Simulating'); steps(match, 1);
  assert.equal(match.getSnapshot().phase, 'Aiming'); assert.equal(match.getSnapshot().turnNumber, 2);
  assert.ok(match.getKeySnapshots().some(s => s.phase === 'Resolving'));
  assert.equal(match.getSimulationStatus().reason, 'stopped'); assert.equal(physics.stops, 1);
  assert.equal(launch().ok, true); assert.equal(physics.launches.length, 2);
});
test('任意一个物体重新运动会重置连续静止时间', () => {
  const { match, physics, launch } = setup();
  physics.onStep = (frame, n) => { frame.ball.velocity.x = n === 10 ? 0.1 : 0; };
  launch(); steps(match, 27); assert.equal(match.getSnapshot().phase, 'Simulating');
  steps(match, 1); assert.equal(match.getSnapshot().phase, 'Aiming');
});
test('30/60/120 帧率固定模拟步数一致；无足够时间不提前补步', () => {
  for (const fps of [30, 60, 120]) {
    const { match, physics, launch } = setup(); launch(); steps(match, fps, 1 / fps);
    assert.equal(physics.steps.length, 18); assert.ok(physics.steps.every(dt => dt === config.fixedStep));
    assert.equal(match.getSimulationStatus().seconds, 0.3);
  }
  const { match, physics, launch } = setup(); launch(); match.advance(config.fixedStep / 2);
  assert.equal(physics.steps.length, 0); match.advance(config.fixedStep / 2); assert.equal(physics.steps.length, 1);
});
test('卡顿最多补 5 步，积压丢弃；暂停丢弃半步，非法帧时间忽略', () => {
  const { match, physics, launch } = setup(); launch(); match.advance(30);
  assert.equal(physics.steps.length, 5); assert.ok(match.getSimulationStatus().droppedSeconds > 29);
  match.advance(0); assert.equal(physics.steps.length, 5);
  match.advance(config.fixedStep / 2); match.discardAccumulatedTime(); match.advance(config.fixedStep / 2);
  assert.equal(physics.steps.length, 5);
  for (const dt of [NaN, Infinity, -1]) match.advance(dt);
  assert.equal(physics.steps.length, 5);
});
test('超时在准确固定步结束，保留最后位置并清零所有速度', () => {
  const { match, physics, launch } = setup({ maxSimulationSeconds: 0.1 });
  physics.onStep = frame => { frame.ball.velocity.x = 0.5; frame.ball.position.x += 0.01; };
  launch(); steps(match, 5); assert.equal(match.getSnapshot().phase, 'Simulating'); steps(match, 1);
  assert.equal(match.getSimulationStatus().reason, 'timeout'); assert.equal(physics.steps.length, 6);
  assert.ok(Math.abs(match.getSnapshot().ball.position.x - 0.06) < 1e-9);
  assert.equal(match.getSnapshot().ball.velocity.x, 0); assert.equal(physics.frame.ball.velocity.x, 0);
});
for (const corruption of ['nan', 'outside', 'missing', 'duplicate', 'speed', 'throws']) {
  test(`物理异常 ${corruption} 恢复发射前快照，并允许下一次操作`, () => {
    const { match, state, physics, launch } = setup();
    physics.onStep = frame => {
      if (corruption === 'nan') frame.ball.position.x = NaN;
      if (corruption === 'outside') frame.ball.position.y = 20;
      if (corruption === 'missing') frame.players.pop();
      if (corruption === 'duplicate') frame.players[1].instanceId = 'a1';
      if (corruption === 'speed') frame.ball.velocity.x = 30;
      if (corruption === 'throws') throw new Error('adapter failed');
    };
    launch(); steps(match, 1);
    assert.equal(match.getSimulationStatus().reason, 'invalid'); assert.equal(match.getSnapshot().phase, 'Aiming');
    assert.deepEqual(match.getSnapshot().players, state.players); assert.deepEqual(match.getSnapshot().ball, state.ball);
    assert.deepEqual(physics.frame.ball, state.ball); assert.equal(match.getSnapshot().turnNumber, 2);
    physics.onStep = () => {}; assert.equal(launch().ok, true); steps(match, 18);
    assert.equal(match.getSimulationStatus().reason, 'stopped');
  });
}
test('重置产生新会话，旧命令拒绝；历史有界且对外复制', () => {
  const old = setup(); const fresh = setup({}, 'normal', 'new-session');
  assert.equal(fresh.match.execute(command(old.state), 'a').reason, 'WrongMatch');
  assert.equal(fresh.physics.launches.length, 0);
  const { match, launch, state } = old;
  for (let i = 0; i < 120; i++) { assert.equal(launch().ok, true); steps(match, 18); }
  assert.equal(match.getAcceptedCommands().length, 100); assert.equal(match.getKeySnapshots().length, 100);
  assert.equal(match.execute(command(state), 'a').reason, 'WrongTurn');
  const snapshots = match.getKeySnapshots(); snapshots[0].ball.position.x = 999;
  assert.notEqual(match.getKeySnapshots()[0].ball.position.x, 999);
  assert.deepEqual(JSON.parse(JSON.stringify(match.getSnapshot())), match.getSnapshot());
});

test('贴墙释放：四边和角落留出间隙，不修改速度或输入状态', () => {
  const radius = config.ballRadius, limitX = config.fieldWidth/2-radius, limitY = config.fieldHeight/2-radius;
  for (const sign of [-1, 1]) {
    const body = { position: { x: sign * limitX, y: sign * limitY }, velocity: { x: 0, y: 0 } };
    const before = clone(body); const p = releaseWallContact(body, radius, config);
    assert.equal(p.x, sign*(limitX-config.wallReleaseGap)); assert.equal(p.y, sign*(limitY-config.wallReleaseGap));
    assert.deepEqual(body, before);
    assert.equal(releaseWallContact({ ...body, position: p }, radius, config), null, '间隙不会每步继续扩大');
  }
});
test('沿墙滑动也可释放；正常反弹和离墙运动不干预', () => {
  const x = config.fieldWidth/2-config.ballRadius;
  const body = { position: { x, y: 0 }, velocity: { x: 0, y: 3 } };
  assert.ok(releaseWallContact(body, config.ballRadius, config).x < x);
  for (const speed of [-1, 1]) assert.equal(releaseWallContact({ ...body, velocity: { x: speed, y: 3 } }, config.ballRadius, config), null);
  assert.equal(releaseWallContact({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } }, config.ballRadius, config), null);
});
test('贴墙释放不掩盖 NaN、无限速度或真正越界，仍交给应用层异常恢复', () => {
  for (const body of [
    { position: { x: NaN, y: 0 }, velocity: { x: 0, y: 0 } },
    { position: { x: config.fieldWidth/2-config.ballRadius, y: 0 }, velocity: { x: Infinity, y: 0 } },
    { position: { x: config.fieldWidth, y: 0 }, velocity: { x: 0, y: 0 } },
  ]) assert.equal(releaseWallContact(body, config.ballRadius, config), null);
});
