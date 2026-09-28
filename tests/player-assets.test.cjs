const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parsePlayerCatalog, getPlayerTemplate, playerGameplayValues } =
  require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups, validateLineups } = require('../.test-output/core/Lineup.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } =
  require('../.test-output/core/PrototypeConfig.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');

const raw = require('../assets/resources/config/players.json');
const catalog = parsePlayerCatalog(raw);
const config = freezeConfig(prototypeConfig);
const clone = value => structuredClone(value);

test('球员目录唯一、头像文件存在且评分在范围内', () => {
  assert.equal(catalog.version, 'players-003');
  assert.equal(catalog.players.length, 6);
  assert.equal(new Set(catalog.players.map(player => player.id)).size, 6);
  for (const player of catalog.players) {
    for (const key of ['weight', 'power', 'precision', 'mentality', 'curve']) {
      assert.ok(Number.isInteger(player[key]) && player[key] >= 0 && player[key] <= 100);
    }
    assert.ok(player.quip.length > 0);
    const filename = path.join(__dirname, '..', 'assets', 'resources', `${player.portraitPath}.png`);
    const bytes = fs.readFileSync(filename);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [...raw.players, raw.players[0]] }), /重复/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], power: 101 }] }), /power/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], mentality: -1 }] }), /mentality/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], quip: '' }] }), /quip/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], portraitPath: '../bad' }] }), /头像路径/);
  assert.throws(() => parsePlayerCatalog({ ...raw, players: [{ ...raw.players[0], skill: {
    id: 'future', params: { amount: Infinity } } }] }), /技能参数/);
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
  lineups.blue[0].position = { x: -2, y: -4 };
  lineups.red[0].position = { x: 2, y: 4 };
  const state = createStandardMatchState('selected', config, 7, catalog, lineups);
  assert.equal(state.catalogVersion, catalog.version);
  assert.equal(state.schemaVersion, 4);
  assert.equal(state.players[0].templateId, 'van-dijk');
  assert.deepEqual(state.players[0].position, { x: -2, y: -4 });
  assert.equal(state.players[0].instanceId, 'blue-1');
  assert.equal(state.players[5].instanceId, 'red-1');
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
