const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } =
  require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog } = require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
const { aimWobbleDegrees, effectiveAimDirection } = require('../.test-output/core/PlayerSkills.js');

const clone = value => structuredClone(value);
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
const config = freezeConfig({ ...prototypeConfig, quietSeconds: 0.05 });

class SkillPhysics {
  launches = [];
  contacts = [];
  onStep = () => {};
  restore(state) { this.frame = clone({ players: state.players, ball: state.ball }); }
  launch(command) { this.launches.push(clone(command)); }
  step(dt) { this.onStep(this.frame, dt); }
  sample() {
    const frame = clone(this.frame);
    frame.ballPlayerContacts = [...this.contacts]; this.contacts = [];
    const line = config.fieldHeight / 2;
    const betweenPosts = Math.abs(frame.ball.position.x) + config.ballRadius <= config.goalWidth / 2 + 1e-9;
    frame.goal = !betweenPosts ? null
      : frame.ball.position.y - config.ballRadius >= line - 1e-9 ? 'top'
        : frame.ball.position.y + config.ballRadius <= -line + 1e-9 ? 'bottom' : null;
    return frame;
  }
  stop() {}
}

function skillLineups() {
  const lineups = clone(defaultLineups());
  lineups.blue[4].templateId = 'neymar'; lineups.red[4].templateId = 'neymar';
  return lineups;
}

function setup(seed = 7) {
  const created = createStandardMatchState('skills', config, seed, catalog, skillLineups());
  const state = { ...created, kickoff: { ...created.kickoff, pending: false } };
  const physics = new SkillPhysics();
  const match = new LocalMatch(state, physics, config);
  return { match, physics };
}

function launch(match, player, commandId, direction = { x: 1, y: 0 }) {
  const state = match.getSnapshot();
  return match.execute({ type: 'Launch', commandId, matchId: state.matchId,
    turnNumber: state.turnNumber, operatorId: state.activeOperatorId,
    playerId: player.instanceId, direction, power: 0.5 }, state.activeOperatorId);
}

function settle(match) {
  for (let step = 0; step < 3; step++) match.advance(config.fixedStep);
}

test('C 罗技能使用权威随机状态，并让对手所见方向与真实发射方向一致', () => {
  const { match, physics } = setup();
  let state = match.getSnapshot();
  const ronaldo = state.players.find(player => player.ownerId === state.activeOperatorId
    && player.templateId === 'cristiano-ronaldo');
  // 用必定触发值隔离概率分支；正式目录仍使用 35%。
  const forced = { ...state, players: state.players.map(player => player.instanceId === ronaldo.instanceId
    ? { ...player, skill: { ...player.skill, params: { ...player.skill.params, chance: 1 } } } : player) };
  const deterministic = new LocalMatch(forced, physics, config);
  assert.equal(launch(deterministic, ronaldo, 'ronaldo').ok, true);
  settle(deterministic);
  state = deterministic.getSnapshot();
  assert.equal(state.skills.aimWobble.sourcePlayerId, ronaldo.instanceId);
  assert.equal(state.skills.aimWobble.targetOperatorId, state.activeOperatorId);
  deterministic.advance(0.137);
  state = deterministic.getSnapshot();
  assert.notEqual(aimWobbleDegrees(state), 0);
  const intended = { x: 1, y: 0 };
  const expected = effectiveAimDirection(state, intended);
  const opponent = state.players.find(player => player.ownerId === state.activeOperatorId);
  assert.equal(launch(deterministic, opponent, 'wobbled', intended).ok, true);
  assert.ok(Math.abs(physics.launches.at(-1).direction.x - expected.x) < 1e-12);
  assert.ok(Math.abs(physics.launches.at(-1).direction.y - expected.y) < 1e-12);
  assert.deepEqual(deterministic.getAcceptedCommands().at(-1).direction, intended);
  assert.equal(deterministic.getSnapshot().skills.aimWobble, null);
});

test('C 罗概率未命中时不创建干扰，且仍确定推进随机状态', () => {
  const { match, physics } = setup(11);
  const before = match.getSnapshot();
  const ronaldo = before.players.find(player => player.ownerId === before.activeOperatorId
    && player.templateId === 'cristiano-ronaldo');
  const never = { ...before, players: before.players.map(player => player.instanceId === ronaldo.instanceId
    ? { ...player, skill: { ...player.skill, params: { ...player.skill.params, chance: 0 } } } : player) };
  const deterministic = new LocalMatch(never, physics, config);
  launch(deterministic, ronaldo, 'no-wobble');
  const after = deterministic.getSnapshot();
  assert.equal(after.skills.aimWobble, null);
  assert.notEqual(after.random.state, before.random.state);
});

test('C 罗正式 35% 概率在相同种子下严格复现且存在命中与未命中', () => {
  const outcomes = new Map();
  for (let seed = 1; seed <= 40; seed++) {
    const run = () => {
      const { match } = setup(seed); const state = match.getSnapshot();
      const ronaldo = state.players.find(player => player.ownerId === state.activeOperatorId
        && player.templateId === 'cristiano-ronaldo');
      launch(match, ronaldo, `seed-${seed}`);
      const after = match.getSnapshot();
      return { triggered: Boolean(after.skills.aimWobble), randomState: after.random.state };
    };
    const first = run(); const second = run();
    assert.deepEqual(first, second); outcomes.set(first.triggered, seed);
    if (outcomes.size === 2) break;
  }
  assert.deepEqual([...outcomes.keys()].sort(), [false, true]);
});

test('内马尔前两次正常行动只累计计数，不提前武装', () => {
  const { match: original } = setup(); const state = original.getSnapshot();
  const neymar = state.players.find(player => player.ownerId === state.activeOperatorId
    && player.templateId === 'neymar');
  for (const [count, expected] of [[0, 1], [1, 2]]) {
    const physics = new SkillPhysics();
    const match = new LocalMatch({ ...state, skills: { ...state.skills,
      launchCounts: { [neymar.instanceId]: count } } }, physics, config);
    launch(match, neymar, `count-${count}`);
    assert.equal(match.getSnapshot().skills.launchCounts[neymar.instanceId], expected);
    assert.equal(match.getSnapshot().skills.bonus, null);
  }
});

test('内马尔第三次正常行动命中敌方后由本人追加一次，奖励行动不累计', () => {
  const { match: original, physics } = setup();
  const before = original.getSnapshot();
  const neymar = before.players.find(player => player.ownerId === before.activeOperatorId
    && player.templateId === 'neymar');
  const armed = { ...before, skills: { ...before.skills, launchCounts: { [neymar.instanceId]: 2 } } };
  const match = new LocalMatch(armed, physics, config);
  const enemy = armed.players.find(player => player.ownerId !== armed.activeOperatorId);
  assert.equal(launch(match, neymar, 'third').ok, true);
  assert.deepEqual(match.getSnapshot().skills.bonus, { playerId: neymar.instanceId, opponentHit: false });
  assert.equal(match.getSnapshot().skills.launchCounts[neymar.instanceId], 0);
  physics.contacts = [enemy.instanceId];
  settle(match);
  let state = match.getSnapshot();
  assert.equal(state.phase, 'Aiming');
  assert.equal(state.activeOperatorId, before.activeOperatorId);
  assert.equal(state.skills.forcedPlayerId, neymar.instanceId);
  assert.equal(match.getSimulationStatus().reason, 'skill-bonus');
  const teammate = state.players.find(player => player.ownerId === state.activeOperatorId
    && player.instanceId !== neymar.instanceId);
  assert.equal(launch(match, teammate, 'wrong-bonus').reason, 'WrongPlayer');
  assert.equal(launch(match, neymar, 'bonus').ok, true);
  state = match.getSnapshot();
  assert.equal(state.skills.launchCounts[neymar.instanceId], 0);
  assert.equal(state.skills.bonus, null);
  settle(match);
  assert.notEqual(match.getSnapshot().activeOperatorId, before.activeOperatorId);
});

test('内马尔第三次行动只碰到队友不会追加', () => {
  const { match: original, physics } = setup();
  const before = original.getSnapshot();
  const neymar = before.players.find(player => player.ownerId === before.activeOperatorId
    && player.templateId === 'neymar');
  const teammate = before.players.find(player => player.ownerId === before.activeOperatorId
    && player.instanceId !== neymar.instanceId);
  const match = new LocalMatch({ ...before, skills: { ...before.skills,
    launchCounts: { [neymar.instanceId]: 2 } } }, physics, config);
  launch(match, neymar, 'teammate-only'); physics.contacts = [teammate.instanceId]; settle(match);
  const after = match.getSnapshot();
  assert.notEqual(after.activeOperatorId, before.activeOperatorId);
  assert.equal(after.skills.forcedPlayerId, null);
});

test('进球和比赛到时优先于内马尔追加行动', () => {
  for (const ending of ['goal', 'time']) {
    const { match: original, physics } = setup();
    const before = original.getSnapshot();
    const neymar = before.players.find(player => player.ownerId === before.activeOperatorId
      && player.templateId === 'neymar');
    const enemy = before.players.find(player => player.ownerId !== before.activeOperatorId);
    const clock = ending === 'time' ? { ...before.clock, remainingMs: 1 } : before.clock;
    const match = new LocalMatch({ ...before, clock, skills: { ...before.skills,
      launchCounts: { [neymar.instanceId]: 2 } } }, physics, config);
    launch(match, neymar, `priority-${ending}`); physics.contacts = [enemy.instanceId];
    if (ending === 'goal') physics.onStep = frame => { frame.ball.position = { x: 0,
      y: before.activeOperatorId === 'blue' ? config.fieldHeight / 2 + config.ballRadius
        : -config.fieldHeight / 2 - config.ballRadius }; };
    settle(match);
    const after = match.getSnapshot();
    assert.equal(after.skills.forcedPlayerId, null);
    if (ending === 'goal') assert.equal(after.score[before.activeOperatorId], 1);
    else assert.equal(after.phase, 'Finished');
  }
});

test('开球直接入门与非法物理帧均取消内马尔追加行动', () => {
  for (const ending of ['kickoff', 'invalid']) {
    const { match: original, physics } = setup();
    const before = original.getSnapshot();
    const neymar = before.players.find(player => player.ownerId === before.activeOperatorId
      && player.templateId === 'neymar');
    const enemy = before.players.find(player => player.ownerId !== before.activeOperatorId);
    const kickoff = ending === 'kickoff' ? { ...before.kickoff, pending: true } : before.kickoff;
    const match = new LocalMatch({ ...before, kickoff, skills: { ...before.skills,
      launchCounts: { [neymar.instanceId]: 2 } } }, physics, config);
    launch(match, neymar, `cancel-${ending}`); physics.contacts = [enemy.instanceId];
    physics.onStep = frame => {
      if (ending === 'kickoff') frame.ball.position = { x: 0,
        y: before.activeOperatorId === 'blue' ? config.fieldHeight / 2 + config.ballRadius
          : -config.fieldHeight / 2 - config.ballRadius };
      else frame.ball.position.x = NaN;
    };
    match.advance(config.fixedStep);
    const after = match.getSnapshot();
    assert.equal(after.skills.forcedPlayerId, null);
    assert.equal(after.skills.bonus, null);
    if (ending === 'kickoff') assert.deepEqual(after.score, before.score);
    else assert.equal(after.skills.launchCounts[neymar.instanceId], 2);
  }
});
