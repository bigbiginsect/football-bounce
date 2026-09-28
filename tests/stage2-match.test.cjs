const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createStandardMatchState, detectGoal } =
  require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog } = require('../.test-output/core/PlayerCatalog.js');
const { createBoundaryWalls, isPlayablePosition } = require('../.test-output/core/BoundaryGeometry.js');

const clone = value => structuredClone(value);
const config = freezeConfig(prototypeConfig);
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));

class FakePhysics {
  launches = []; steps = []; stops = 0; onStep = () => {};
  constructor(config) { this.config = config; }
  restore(state) { this.frame = clone({ players: state.players, ball: state.ball }); }
  launch(command) { this.launches.push(clone(command)); }
  step(dt) { this.steps.push(dt); this.onStep(this.frame, this.steps.length); }
  sample() {
    const snapshot = clone(this.frame); const line = this.config.fieldHeight / 2;
    const betweenPosts = Math.abs(snapshot.ball.position.x) + this.config.ballRadius <= this.config.goalWidth / 2 + 1e-9;
    snapshot.goal = !betweenPosts ? null
      : snapshot.ball.position.y - this.config.ballRadius >= line - 1e-9 ? 'top'
        : snapshot.ball.position.y + this.config.ballRadius <= -line + 1e-9 ? 'bottom' : null;
    return snapshot;
  }
  stop() { this.stops++; }
}

function setup(patch = {}, seed = 123, kickoffPending = true) {
  const currentConfig = freezeConfig({ ...config, ...patch });
  const created = createStandardMatchState('standard-test', currentConfig, seed, catalog);
  const state = { ...created, kickoff: { ...created.kickoff, pending: kickoffPending } };
  const physics = new FakePhysics(currentConfig);
  const match = new LocalMatch(state, physics, currentConfig);
  let commandSequence = 0;
  const launch = () => {
    const snapshot = match.getSnapshot();
    const player = snapshot.players.find(item => item.ownerId === snapshot.activeOperatorId);
    return match.execute({ type: 'Launch', commandId: `stage2-${++commandSequence}`,
      matchId: snapshot.matchId, turnNumber: snapshot.turnNumber,
      operatorId: snapshot.activeOperatorId, playerId: player.instanceId,
      direction: { x: 0, y: 1 }, power: 0.5 }, snapshot.activeOperatorId);
  };
  return { config: currentConfig, state, physics, match, launch };
}

function fixedSteps(match, count, step = config.fixedStep) {
  for (let index = 0; index < count; index++) match.advance(step);
}

test('标准模式创建 5v5，模式局时和瞄准时限来自配置，开局位置无重叠', () => {
  const state = createStandardMatchState('m', config, 42, catalog);
  assert.equal(state.schemaVersion, 4);
  assert.equal(state.catalogVersion, catalog.version);
  assert.equal(state.modeId, 'standard');
  assert.equal(state.players.filter(player => player.ownerId === 'blue').length, 5);
  assert.equal(state.players.filter(player => player.ownerId === 'red').length, 5);
  assert.equal(new Set(state.players.map(player => player.instanceId)).size, 10);
  assert.equal(state.clock.matchDurationMs, 180000);
  assert.equal(state.clock.turnDurationMs, 20000);
  assert.equal(state.random.seed, 42);
  assert.equal(state.random.firstOperatorId, state.activeOperatorId);
  for (let left = 0; left < state.players.length; left++) for (let right = left + 1; right < state.players.length; right++) {
    const a = state.players[left].position; const b = state.players[right].position;
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 2 * config.playerRadius);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('同种子严格复现先手和随机状态，样本种子能产生双方先手', () => {
  const first = createStandardMatchState('one', config, 20260922, catalog);
  const second = createStandardMatchState('two', config, 20260922, catalog);
  assert.deepEqual(first.random, second.random);
  const outcomes = new Set();
  for (let seed = 1; seed <= 100; seed++) outcomes.add(createStandardMatchState(`m-${seed}`, config, seed, catalog).activeOperatorId);
  assert.deepEqual([...outcomes].sort(), ['blue', 'red']);
  assert.throws(() => createStandardMatchState('bad', config, -1, catalog));
  assert.throws(() => createStandardMatchState('bad', config, 0x100000000, catalog));
});

test('普通运动完全停止后交换行动方并重置 20 秒瞄准时间', () => {
  const { match, launch } = setup();
  const before = match.getSnapshot();
  assert.equal(launch().ok, true);
  fixedSteps(match, 18);
  const after = match.getSnapshot();
  assert.equal(after.phase, 'Aiming');
  assert.notEqual(after.activeOperatorId, before.activeOperatorId);
  assert.equal(after.turnNumber, 2);
  assert.equal(after.clock.turnRemainingMs, 20000);
  assert.ok(after.clock.remainingMs < before.clock.remainingMs);
  assert.equal(after.kickoff.pending, false);
});

test('上一回合已接受的命令 ID 在历史窗口内仍按重复命令拒绝', () => {
  const { match, physics, launch } = setup();
  launch(); fixedSteps(match, 18);
  const accepted = physics.launches[0];
  assert.equal(match.execute(accepted, accepted.operatorId).reason, 'DuplicateCommand');
});

test('瞄准 20 秒超时自动换手，大步推进可跨多个回合且比赛时间同步减少', () => {
  const { match } = setup();
  const first = match.getSnapshot().activeOperatorId;
  match.advance(20);
  let state = match.getSnapshot();
  assert.notEqual(state.activeOperatorId, first);
  assert.equal(state.turnNumber, 2);
  assert.equal(state.clock.turnRemainingMs, 20000);
  assert.equal(match.getSimulationStatus().reason, 'turn-timeout');
  assert.equal(state.kickoff.pending, true);
  match.advance(45);
  state = match.getSnapshot();
  assert.equal(state.turnNumber, 4);
  assert.equal(state.clock.turnRemainingMs, 15000);
  assert.equal(state.clock.remainingMs, 115000);
});

test('比赛在 Aiming 阶段到时立即结束，平局不加时且结束后拒绝操作', () => {
  const { match, launch } = setup({ matchSeconds: 10 });
  match.advance(10);
  const state = match.getSnapshot();
  assert.equal(state.phase, 'Finished');
  assert.deepEqual(state.result, { winnerId: null, reason: 'TimeExpired' });
  assert.equal(state.clock.remainingMs, 0);
  assert.equal(launch().reason, 'WrongPhase');
  const frozen = match.getSnapshot(); match.advance(50); assert.deepEqual(match.getSnapshot(), frozen);
});

test('皮球必须整体越线且整体位于门柱之间，球门口不执行端线贴墙释放', () => {
  const make = (x, y) => ({ ...createStandardMatchState('goal', config, 1, catalog),
    ball: { position: { x, y }, velocity: { x: 0, y: 0 } } });
  const line = config.fieldHeight / 2;
  assert.equal(detectGoal(make(0, line + config.ballRadius - 1e-5), config), null);
  assert.equal(detectGoal(make(0, line + config.ballRadius), config), 'blue');
  assert.equal(detectGoal(make(0, -line - config.ballRadius), config), 'red');
  assert.equal(detectGoal(make(config.goalWidth / 2 - config.ballRadius + 1e-5,
    line + config.ballRadius), config), null);
  const { releaseWallContact } = require('../.test-output/core/WallContact.js');
  assert.equal(releaseWallContact({ position: { x: 0, y: line - config.ballRadius },
    velocity: { x: 0, y: 0 } }, config.ballRadius, config), null);
});

test('上下球门两侧墙体从门线向外延伸，门柱前侧保留圆球的斜向通路', () => {
  const walls = createBoundaryWalls(config);
  const halfLine = config.fieldHeight / 2;
  const halfOpening = config.goalWidth / 2;
  const sideWalls = walls.filter(wall => wall.width === config.wallThickness
    && wall.height === config.goalDepth + config.wallThickness);
  assert.equal(sideWalls.length, 4);
  for (const end of [-1, 1]) for (const side of [-1, 1]) {
    const wall = sideWalls.find(item => Math.sign(item.x) === side && Math.sign(item.y) === end);
    assert.ok(wall);
    assert.equal(Math.abs(wall.y) - wall.height / 2, halfLine);
    assert.equal(Math.abs(wall.x) - wall.width / 2, halfOpening);
    // 斜向接近门柱时，该点离门柱角大于球半径，不能被侧壁提前挡住。
    const x = side * (halfOpening - 0.12);
    const y = end * (halfLine - 0.12);
    const dx = Math.max(Math.abs(x - wall.x) - wall.width / 2, 0);
    const dy = Math.max(Math.abs(y - wall.y) - wall.height / 2, 0);
    assert.ok(Math.hypot(dx, dy) > config.ballRadius);
  }
});

test('门柱角外侧的聚集球员位置合法，发射后继续运动而不误报异常换手', () => {
  const { match, physics, launch } = setup();
  const before = match.getSnapshot();
  const target = before.players.find(player => player.ownerId === 'red');
  const x = config.goalWidth / 2 - 0.2;
  const y = config.fieldHeight / 2 - 0.2;
  assert.ok(x > config.goalWidth / 2 - config.playerRadius + 0.04);
  assert.ok(y > config.fieldHeight / 2 - config.playerRadius + 0.04);
  assert.equal(isPlayablePosition({ x, y }, config.playerRadius, config), true);
  physics.onStep = frame => {
    frame.players.find(player => player.instanceId === target.instanceId).position = { x, y };
  };
  assert.equal(launch().ok, true);
  fixedSteps(match, 1);
  assert.equal(match.getSnapshot().phase, 'Simulating');
  assert.equal(match.getSimulationStatus().reason, 'moving');
  fixedSteps(match, 17);
  assert.equal(match.getSimulationStatus().reason, 'stopped');
  assert.equal(match.getSnapshot().turnNumber, before.turnNumber + 1);
});

test('门柱角内的真实墙体侵入及明显越界仍拒绝', () => {
  const halfGoal = config.goalWidth / 2;
  const halfLine = config.fieldHeight / 2;
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    assert.equal(isPlayablePosition({ x: side * (halfGoal - 0.2),
      y: end * (halfLine - 0.2) }, config.playerRadius, config), true);
    assert.equal(isPlayablePosition({ x: side * (halfGoal - 0.15),
      y: end * (halfLine - 0.15) }, config.playerRadius, config), false);
  }
  assert.equal(isPlayablePosition({ x: config.fieldWidth, y: 0 }, config.playerRadius, config), false);
  assert.equal(isPlayablePosition({ x: 0, y: halfLine + config.goalDepth }, config.playerRadius, config), false);
});

test('开球直接入门判违例，不计分、全体复位并连续换边开球', () => {
  const { match, physics, launch, config: currentConfig } = setup();
  const initial = match.getSnapshot();
  const directGoal = () => {
    const active = match.getSnapshot().activeOperatorId;
    physics.onStep = frame => { frame.ball.position = { x: 0,
      y: active === 'blue' ? currentConfig.fieldHeight / 2 + currentConfig.ballRadius
        : -currentConfig.fieldHeight / 2 - currentConfig.ballRadius }; };
    assert.equal(launch().ok, true); fixedSteps(match, 1);
  };
  directGoal();
  let after = match.getSnapshot();
  assert.deepEqual(after.score, initial.score);
  assert.notEqual(after.activeOperatorId, initial.activeOperatorId);
  assert.equal(after.kickoff.pending, true);
  assert.equal(after.phase, 'Aiming');
  assert.equal(match.getSimulationStatus().reason, 'kickoff-violation');
  assert.deepEqual(after.ball.position, after.kickoff.ballPosition);
  for (const player of after.players) {
    assert.deepEqual(player.position, after.kickoff.players.find(item => item.instanceId === player.instanceId).position);
  }
  const secondKickoffSide = after.activeOperatorId;
  directGoal();
  after = match.getSnapshot();
  assert.deepEqual(after.score, initial.score);
  assert.notEqual(after.activeOperatorId, secondKickoffSide);
  assert.equal(after.kickoff.pending, true);
});

test('开球未进球并停止后解除限制，下一回合进球正常计分并重新等待开球', () => {
  const { match, physics, launch, config: currentConfig } = setup();
  launch(); fixedSteps(match, 18);
  const openPlay = match.getSnapshot();
  assert.equal(openPlay.kickoff.pending, false);
  const scorer = openPlay.activeOperatorId;
  physics.onStep = frame => { frame.ball.position = { x: 0,
    y: scorer === 'blue' ? currentConfig.fieldHeight / 2 + currentConfig.ballRadius
      : -currentConfig.fieldHeight / 2 - currentConfig.ballRadius }; };
  launch(); fixedSteps(match, 1);
  const after = match.getSnapshot();
  assert.equal(after.score[scorer], 1);
  assert.equal(after.activeOperatorId, scorer === 'blue' ? 'red' : 'blue');
  assert.equal(after.kickoff.pending, true);
  assert.equal(match.getSimulationStatus().reason, 'goal');
});

test('开球违例发生在比赛到时当步时不计分，复位后结束比赛', () => {
  const { match, physics, launch, config: currentConfig } = setup({ matchSeconds: 10 });
  match.advance(9.99);
  const active = match.getSnapshot().activeOperatorId;
  physics.onStep = frame => { frame.ball.position = { x: 0,
    y: active === 'blue' ? currentConfig.fieldHeight / 2 + currentConfig.ballRadius
      : -currentConfig.fieldHeight / 2 - currentConfig.ballRadius }; };
  launch(); match.advance(0.02);
  const after = match.getSnapshot();
  assert.deepEqual(after.score, { blue: 0, red: 0 });
  assert.equal(after.phase, 'Finished');
  assert.equal(after.result.winnerId, null);
  assert.equal(after.kickoff.pending, true);
  assert.deepEqual(after.ball.position, after.kickoff.ballPosition);
});

test('进球只加一分，全部恢复开局位置并由失球方行动', () => {
  const { match, physics, launch, config: currentConfig } = setup({}, 123, false);
  const before = match.getSnapshot();
  const scorer = before.activeOperatorId;
  const targetY = scorer === 'blue' ? currentConfig.fieldHeight / 2 + currentConfig.ballRadius
    : -currentConfig.fieldHeight / 2 - currentConfig.ballRadius;
  physics.onStep = frame => { frame.ball.position = { x: 0, y: targetY }; };
  assert.equal(launch().ok, true); fixedSteps(match, 1);
  const after = match.getSnapshot();
  const conceding = scorer === 'blue' ? 'red' : 'blue';
  assert.equal(after.score[scorer], 1);
  assert.equal(after.score[conceding], 0);
  assert.equal(after.activeOperatorId, conceding);
  assert.equal(after.phase, 'Aiming');
  assert.equal(after.kickoff.pending, true);
  assert.deepEqual(after.ball.position, after.kickoff.ballPosition);
  for (const player of after.players) {
    assert.deepEqual(player.position, after.kickoff.players.find(item => item.instanceId === player.instanceId).position);
  }
  assert.equal(physics.stops, 1);
  fixedSteps(match, 60);
  assert.equal(match.getSnapshot().score[scorer], 1);
});

test('运动中比赛到时继续等待停止，再按最终比分结束', () => {
  const { match, physics, launch } = setup({ matchSeconds: 10 });
  match.advance(9.99);
  physics.onStep = frame => { frame.ball.velocity = { x: 0.5, y: 0 }; };
  assert.equal(launch().ok, true);
  match.advance(0.02);
  let state = match.getSnapshot();
  assert.equal(state.clock.remainingMs, 0);
  assert.equal(state.phase, 'Simulating');
  physics.onStep = frame => { frame.ball.velocity = { x: 0, y: 0 }; };
  fixedSteps(match, 18);
  state = match.getSnapshot();
  assert.equal(state.phase, 'Finished');
  assert.deepEqual(state.result, { winnerId: null, reason: 'TimeExpired' });
});

test('运动到时当步的有效进球先计分再结束比赛', () => {
  const { match, physics, launch, config: currentConfig } = setup({ matchSeconds: 10 }, 5, false);
  match.advance(9.99);
  const scorer = match.getSnapshot().activeOperatorId;
  physics.onStep = frame => { frame.ball.position = { x: 0,
    y: scorer === 'blue' ? currentConfig.fieldHeight / 2 + currentConfig.ballRadius
      : -currentConfig.fieldHeight / 2 - currentConfig.ballRadius }; };
  launch(); match.advance(0.02);
  const state = match.getSnapshot();
  assert.equal(state.phase, 'Finished');
  assert.equal(state.score[scorer], 1);
  assert.equal(state.result.winnerId, scorer);
});

test('状态快照可恢复且新比赛的 ID、种子、比分和时钟互不残留', () => {
  const original = setup({}, 88);
  original.match.advance(3.25);
  const snapshot = JSON.parse(JSON.stringify(original.match.getSnapshot()));
  const restoredPhysics = new FakePhysics(original.config);
  const restored = new LocalMatch(snapshot, restoredPhysics, original.config);
  assert.deepEqual(restored.getSnapshot(), snapshot);
  assert.deepEqual(restoredPhysics.frame.ball, snapshot.ball);
  const fresh = createStandardMatchState('fresh', original.config, 99, catalog);
  assert.notEqual(fresh.matchId, snapshot.matchId);
  assert.notEqual(fresh.random.seed, snapshot.random.seed);
  assert.deepEqual(fresh.score, { blue: 0, red: 0 });
  assert.equal(fresh.clock.remainingMs, fresh.clock.matchDurationMs);
  assert.equal(fresh.turnNumber, 1);
});

test('运动中快照恢复后继续模拟，异常时回到最近权威状态而不崩溃', () => {
  const original = setup(); original.launch(); fixedSteps(original.match, 1);
  const snapshot = original.match.getSnapshot();
  const physics = new FakePhysics(original.config);
  const restored = new LocalMatch(snapshot, physics, original.config);
  assert.equal(restored.getSimulationStatus().reason, 'moving');
  physics.onStep = frame => { frame.ball.position.x = NaN; };
  assert.doesNotThrow(() => restored.advance(original.config.fixedStep));
  const after = restored.getSnapshot();
  assert.equal(after.phase, 'Aiming');
  assert.equal(restored.getSimulationStatus().reason, 'invalid');
  assert.equal(after.turnNumber, snapshot.turnNumber + 1);
});
