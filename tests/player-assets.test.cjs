const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePlayerCatalog, getPlayerTemplate, playerGameplayValues, playerSkillPresentation } =
  require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups, validateLineups } = require('../.test-output/core/Lineup.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } =
  require('../.test-output/core/PrototypeConfig.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');

const raw = require('../assets/resources/config/players.json');
const catalog = parsePlayerCatalog(raw);
const config = freezeConfig(prototypeConfig);
const clone = value => structuredClone(value);

test('球员目录唯一，既有头像与新增姓名占位都有效', () => {
  assert.equal(catalog.version, 'players-005');
  assert.equal(catalog.players.length, 16);
  assert.equal(new Set(catalog.players.map(player => player.id)).size, 16);
  assert.equal(catalog.players.filter(player => player.portraitPath).length, 6);
  assert.equal(catalog.players.filter(player => !player.portraitPath).length, 10);
  for (const player of catalog.players) {
    for (const key of ['weight', 'power', 'precision', 'mentality', 'curve']) {
      assert.ok(Number.isInteger(player[key]) && player[key] >= 0 && player[key] <= 100);
    }
    assert.ok(player.quip.length > 0);
    if (player.portraitPath) {
      const filename = path.join(__dirname, '..', 'assets', 'resources', `${player.portraitPath}.png`);
      const bytes = fs.readFileSync(filename);
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    }
  }
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [...raw.players, raw.players[0]] }), /重复/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], power: 101 }] }), /power/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], mentality: -1 }] }), /mentality/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], quip: '' }] }), /quip/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], portraitPath: '../bad' }] }), /头像路径/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], skill: {
    id: 'future', params: { amount: Infinity } } }] }), /技能参数/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], skill: {
    id: 'aim-wobble', params: { chance: 2, amplitudeDegrees: 9, frequencyHz: 1.4 } } }] }), /瞄准干扰/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], skill: {
    id: 'ball-hit-encore', params: { everyTurns: 1 } } }] }), /追加行动/);
  assert.match(playerSkillPresentation(getPlayerTemplate(catalog, 'cristiano-ronaldo')).description, /35%/);
  assert.match(playerSkillPresentation(getPlayerTemplate(catalog, 'neymar')).description, /第 3 次/);
});

test('评分映射以 50 分为现有基准并保持单调', () => {
  const base = { ...catalog.players[0], weight: 50, power: 50, precision: 50 };
  const middle = playerGameplayValues(base, config);
  assert.equal(middle.mass, config.playerMass);
  assert.equal(middle.maxImpulse, config.maxImpulse);
  assert.equal(middle.aimLength, config.aimLength);
  assert.equal(middle.powerCircleMaxRadius, config.powerCircleMaxRadius);
  const low = playerGameplayValues({ ...base, weight: 0, power: 0, precision: 0 }, config);
  const high = playerGameplayValues({ ...base, weight: 100, power: 100, precision: 100 }, config);
  for (const key of ['mass', 'maxImpulse', 'aimLength', 'powerCircleMaxRadius']) {
    assert.ok(low[key] < middle[key] && middle[key] < high[key]);
  }
  assert.ok(playerGameplayValues(getPlayerTemplate(catalog, 'van-dijk'), config).mass
    > playerGameplayValues(getPlayerTemplate(catalog, 'messi'), config).mass);
});

test('重量决定碰撞动量但不抵消同力量球员的起步速度', () => {
  const light = playerGameplayValues(getPlayerTemplate(catalog, 'neymar'), config);
  const heavy = playerGameplayValues(getPlayerTemplate(catalog, 'ruben-dias'), config);
  const samePowerLight = playerGameplayValues({ ...getPlayerTemplate(catalog, 'neymar'), power: 80 }, config);
  const samePowerHeavy = playerGameplayValues({ ...getPlayerTemplate(catalog, 'ruben-dias'), power: 80 }, config);
  assert.ok(heavy.mass / light.mass > 3);
  assert.ok(Math.abs(samePowerLight.maxImpulse / samePowerLight.mass
    - samePowerHeavy.maxImpulse / samePowerHeavy.mass) < 1e-12);
  // 一维正碰中静止目标获得的速度：重撞轻明显大于轻撞重。
  const restitution = config.playerRestitution;
  const lightHitsHeavy = (1 + restitution) * light.mass / (light.mass + heavy.mass);
  const heavyHitsLight = (1 + restitution) * heavy.mass / (light.mass + heavy.mass);
  assert.ok(heavyHitsLight / lightHitsHeavy > 3);
});

test('相近评分仍产生可测差异且 50 分附近连续', () => {
  const base = { ...catalog.players[0], weight: 50, power: 50, precision: 50 };
  const fifty = playerGameplayValues(base, config);
  const fiftyFive = playerGameplayValues({ ...base, weight: 55, power: 55, precision: 55 }, config);
  assert.ok(fiftyFive.mass / fifty.mass > 1.1);
  assert.ok(fiftyFive.maxImpulse / fiftyFive.mass > fifty.maxImpulse / fifty.mass);
  assert.ok(fiftyFive.aimLength > fifty.aimLength);
  assert.ok(fiftyFive.powerCircleMaxRadius > fifty.powerCircleMaxRadius);
  for (const player of catalog.players) {
    const values = playerGameplayValues(player, config);
    assert.ok(values.maxImpulse / values.mass < config.maxSpeed,
      `${player.id} 的满力度起步速度不应被全局速度上限抹平`);
  }
});

test('两队可用同一五人，但队内重复、越界、重叠和未知模板被拒绝', () => {
  const lineups = defaultLineups();
  const valid = validateLineups(lineups, catalog, config);
  assert.deepEqual(valid.blue.map(item => item.templateId), valid.red.map(item => item.templateId));
  const mutate = fn => { const value = clone(lineups); fn(value); return value; };
  assert.throws(() => validateLineups(mutate(value => { value.blue[1].templateId = value.blue[0].templateId; }), catalog, config), /重复/);
  assert.throws(() => validateLineups(mutate(value => { value.blue[0].templateId = 'missing'; }), catalog, config), /未知/);
  assert.throws(() => validateLineups(mutate(value => { value.blue[0].position.y = 1; }), catalog, config), /区域/);
  assert.throws(() => validateLineups(mutate(value => { value.blue[0].position.x = 99; }), catalog, config), /区域/);
  assert.throws(() => validateLineups(mutate(value => { value.blue[1].position = value.blue[0].position; }), catalog, config), /重叠/);
  assert.throws(() => validateLineups(mutate(value => { value.blue[0].position = { x: 0, y: -config.playerRadius }; }), catalog, config), /区域/);
});

test('传入阵容建立独立实例，目录版本和自选位置经过序列化仍可复位', () => {
  const lineups = clone(defaultLineups());
  lineups.blue[4].templateId = 'neymar'; lineups.red[4].templateId = 'neymar';
  lineups.blue[0].position = { x: -2, y: -4 };
  lineups.red[0].position = { x: 2, y: 4 };
  const state = createStandardMatchState('selected', config, 7, catalog, lineups);
  assert.equal(state.catalogVersion, catalog.version);
  assert.equal(state.schemaVersion, 5);
  assert.equal(state.players[0].templateId, 'van-dijk');
  assert.deepEqual(state.players[0].position, { x: -2, y: -4 });
  assert.equal(state.players[0].instanceId, 'blue-1');
  assert.equal(state.players[5].instanceId, 'red-1');
  assert.equal(state.players.find(player => player.templateId === 'cristiano-ronaldo').skill.id, 'aim-wobble');
  assert.equal(state.players.find(player => player.templateId === 'neymar').skill.id, 'ball-hit-encore');
  assert.deepEqual(state.skills, { launchCounts: {}, aimWobble: null, bonus: null, forcedPlayerId: null });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

  class GoalPhysics {
    restore(snapshot) { this.frame = clone({ players: snapshot.players, ball: snapshot.ball }); }
    launch() {}
    step() { this.frame.ball.position = { x: 0, y: config.fieldHeight / 2 + config.ballRadius }; }
    sample() { return { ...clone(this.frame), goal: 'top' }; }
    stop() {}
  }
  const physics = new GoalPhysics();
  const openPlayState = { ...state, kickoff: { ...state.kickoff, pending: false } };
  const match = new LocalMatch(openPlayState, physics, config);
  const owner = state.activeOperatorId;
  const chosen = state.players.find(player => player.ownerId === owner);
  assert.equal(match.execute({ type: 'Launch', commandId: 'goal-1', matchId: state.matchId,
    turnNumber: state.turnNumber, operatorId: owner, playerId: chosen.instanceId,
    direction: { x: 0, y: 1 }, power: 0.5 }, owner).ok, true);
  match.advance(config.fixedStep);
  const after = match.getSnapshot();
  assert.equal(after.score.blue, 1);
  assert.deepEqual(after.players[0].position, { x: -2, y: -4 });
  assert.equal(after.players[0].templateId, 'van-dijk');
  assert.equal(after.catalogVersion, catalog.version);
});
