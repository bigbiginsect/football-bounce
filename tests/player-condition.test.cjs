const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePlayerCatalog, createPlayerConditions, conditionProbabilities, conditionPresentation,
  effectiveAttributes, matchPlayerAttributes, conditionPowerMultiplier, playerGameplayValues } = require('../.test-output/core/PlayerCatalog.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } = require('../.test-output/core/PrototypeConfig.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const raw = require('../assets/resources/config/players.json');
const catalog = parsePlayerCatalog(raw); const config = freezeConfig(prototypeConfig);
const copy = value => structuredClone(value);
const neutral = { seed: 7, randomState: 9, values: {} };
function lineupState(blue = ['zidane', 'toni-kroos']) {
  const selections = copy(defaultLineups()); blue.forEach((id, index) => { selections.blue[index].templateId = id; });
  return createStandardMatchState('condition', config, 7, catalog, selections, neutral);
}

test('心理概率归一、红随心理单调上升、绿单调下降且中性固定', () => {
  let previous = { up: 0, down: 1 };
  for (let mentality = 0; mentality <= 100; mentality++) {
    const chances = conditionProbabilities(mentality);
    assert.ok(Math.abs(chances.up + chances.normal + chances.down - 1) < 1e-12);
    assert.equal(chances.normal, .3); assert.ok(chances.up > previous.up); assert.ok(chances.down < previous.down);
    previous = chances;
  }
  assert.throws(() => conditionProbabilities(NaN)); assert.throws(() => conditionProbabilities(101));
  assert.equal(conditionPresentation('up').arrow, '↑'); assert.equal(conditionPresentation('normal').arrow, '');
  assert.deepEqual(conditionPresentation('down').rgb, [32, 165, 73]);
});

test('启动抽签同种子同结果、覆盖全部模板、不改目录，非法种子拒绝', () => {
  const before = JSON.stringify(catalog); const first = createPlayerConditions(catalog, 123);
  assert.deepEqual(first, createPlayerConditions(catalog, 123));
  assert.notDeepEqual(first.values, createPlayerConditions(catalog, 456).values);
  assert.equal(Object.keys(first.values).length, 22);
  assert.ok(Object.values(first.values).every(value => ['up', 'normal', 'down'].includes(value)));
  assert.equal(JSON.stringify(catalog), before);
  for (const seed of [-1, NaN, Infinity, 1.5, 0x100000000]) assert.throws(() => createPlayerConditions(catalog, seed));
});

test('状态严格±20%取整，重量与心理不变，生效评分可超过100且不污染基础值', () => {
  const base = { weight: 80, mentality: 90, power: 89, precision: 100, curve: 75 };
  assert.deepEqual(effectiveAttributes(base, 'up'), { weight: 80, mentality: 90, power: 107, precision: 120, curve: 90 });
  assert.deepEqual(effectiveAttributes(base, 'down'), { weight: 80, mentality: 90, power: 71, precision: 80, curve: 60 });
  assert.deepEqual(effectiveAttributes(base), base); assert.equal(base.power, 89);
});

test('启动状态贯穿重开、同模板双队与JSON快照恢复，外部引用不能改比赛', () => {
  const session = createPlayerConditions(catalog, 999);
  const first = createStandardMatchState('one', config, 1, catalog, defaultLineups(), session);
  const second = createStandardMatchState('two', config, 2, catalog, defaultLineups(), session);
  assert.deepEqual(first.conditions, second.conditions);
  assert.deepEqual(new LocalMatch(JSON.parse(JSON.stringify(first))).getSnapshot(), first);
  assert.throws(() => new LocalMatch({ ...first, schemaVersion: 5 }), /快照版本不兼容/);
  const blue = first.players[0]; const red = first.players[5];
  assert.equal(blue.templateId, red.templateId);
  assert.deepEqual(matchPlayerAttributes(blue, first), matchPlayerAttributes(red, first));
  session.values[blue.templateId] = 'invalid';
  assert.notEqual(first.conditions.values[blue.templateId], 'invalid');
  assert.throws(() => createStandardMatchState('bad', config, 1, catalog, defaultLineups(), session), /状态记录/);
});

test('齐达内在己方半场强化本队，进入敌方半场改为削弱对方，中线按己方', () => {
  const state = lineupState(['zidane']); const source = state.players[0]; const enemy = state.players[5];
  assert.equal(matchPlayerAttributes(source, state).curve, Math.round(source.attributes.curve * 1.1));
  assert.deepEqual(matchPlayerAttributes(enemy, state), enemy.attributes);
  source.position.y = 1;
  assert.deepEqual(matchPlayerAttributes(source, state), source.attributes);
  assert.equal(matchPlayerAttributes(enemy, state).power, Math.round(enemy.attributes.power * .9));
  assert.equal(matchPlayerAttributes(enemy, state).weight, enemy.attributes.weight);
  assert.equal(matchPlayerAttributes(enemy, state).mentality, enemy.attributes.mentality);
  source.position.y = 0; assert.equal(matchPlayerAttributes(source, state).precision, Math.round(source.attributes.precision * 1.1));
});

test('克罗斯只影响力量精准，红队上下半场镜像正确', () => {
  const state = lineupState([]); const source = state.players[5];
  source.skill = catalog.players.find(p => p.id === 'toni-kroos').skill;
  const ally = state.players[6]; const enemy = state.players[0];
  assert.equal(matchPlayerAttributes(ally, state).power, Math.round(ally.attributes.power * 1.1));
  assert.equal(matchPlayerAttributes(ally, state).curve, ally.attributes.curve);
  source.position.y = -1;
  assert.equal(matchPlayerAttributes(enemy, state).precision, Math.round(enemy.attributes.precision * .9));
  assert.deepEqual(matchPlayerAttributes(ally, state), ally.attributes);
});

test('双光环与红状态按基础百分点叠加一次取整，反复读取不会累计', () => {
  const state = lineupState(); const target = state.players[4]; state.conditions.values[target.templateId] = 'up';
  const before = JSON.stringify(state); const result = matchPlayerAttributes(target, state);
  assert.equal(result.power, Math.round(target.attributes.power * 1.4));
  assert.equal(result.curve, Math.round(target.attributes.curve * 1.3));
  assert.deepEqual(matchPlayerAttributes(target, state), result); assert.equal(JSON.stringify(state), before);
});

test('非法半场参数被目录运行时校验拒绝', () => {
  for (const percent of [0, -.1, .51, NaN, '0.1']) {
    assert.throws(() => parsePlayerCatalog({ version: 'invalid', players: [{ ...raw.players.at(-1),
      skill: { id: 'half-playmaker-aura', params: { percent } } }] }));
  }
});

test('权威发射倍率与生效力量映射一致，命令仍只保存归一化力度', () => {
  const state = lineupState(); const target = state.players[4];
  state.activeOperatorId = target.ownerId; state.conditions.values[target.templateId] = 'up';
  let actual; const physics = { restore() {}, launch(command, multiplier) { actual = { command, multiplier }; } };
  const match = new LocalMatch(state, physics, config);
  const command = { type: 'Launch', commandId: 'power', matchId: state.matchId, turnNumber: 1,
    operatorId: target.ownerId, playerId: target.instanceId, direction: { x: 1, y: 0 }, power: .5 };
  assert.equal(match.execute(command, target.ownerId).ok, true);
  const template = catalog.players.find(p => p.id === target.templateId);
  const base = playerGameplayValues(template, config);
  const effective = playerGameplayValues({ ...template, ...matchPlayerAttributes(target, state) }, config);
  assert.ok(Math.abs(actual.multiplier - effective.maxImpulse / base.maxImpulse) < 1e-12);
  assert.equal(base.mass, effective.mass); assert.ok(effective.aimLength > base.aimLength);
  assert.equal(actual.multiplier, conditionPowerMultiplier(target, state, config));
  assert.deepEqual(match.getAcceptedCommands(), [command]);
});

test('固定步权威位置更新切换半场效果，物理帧不能篡改基础评分', () => {
  const initial = lineupState(['zidane']); initial.activeOperatorId = 'blue';
  const frame = { players: initial.players.map(p => ({ ...copy(p), position: { ...p.position,
    y: p.instanceId === 'blue-1' ? 1 : p.position.y }, attributes: { power: 999 } })),
    ball: copy(initial.ball), goal: null, ballPlayerContacts: [] };
  const physics = { restore() {}, launch() {}, step() {}, sample() { return frame; }, stop() {} };
  const match = new LocalMatch(initial, physics, config);
  match.execute({ type: 'Launch', commandId: 'cross', matchId: initial.matchId, turnNumber: 1,
    operatorId: 'blue', playerId: 'blue-1', direction: { x: 0, y: 1 }, power: .5 }, 'blue');
  match.advance(config.fixedStep); const after = match.getSnapshot();
  assert.deepEqual(after.players[0].attributes, initial.players[0].attributes);
  assert.equal(after.players[0].position.y, 1);
  assert.equal(matchPlayerAttributes(after.players[5], after).power, Math.round(after.players[5].attributes.power * .9));
});

test('双方半场技能可抵消，快照恢复与位置复位后重新派生且不残留', () => {
  const state = lineupState(['zidane']); const target = state.players[1];
  state.players[5].skill = state.players[0].skill; state.players[5].position.y = -1;
  assert.deepEqual(matchPlayerAttributes(target, state), target.attributes);
  state.players[0].position.y = 1;
  assert.equal(matchPlayerAttributes(target, state).power, Math.round(target.attributes.power * .9));
  const restored = new LocalMatch(JSON.parse(JSON.stringify(state))).getSnapshot();
  assert.deepEqual(matchPlayerAttributes(restored.players[1], restored), matchPlayerAttributes(target, state));
  restored.players.forEach(player => { player.position = copy(restored.kickoff.players.find(p => p.instanceId === player.instanceId).position); });
  assert.equal(matchPlayerAttributes(restored.players[1], restored).power, Math.round(target.attributes.power * 1.1));
});

test('强力发射周期倍率与心理/半场力量倍率相乘，状态加成不绕过技能计数', () => {
  const state = lineupState(); const target = state.players.find(player => player.skill?.id === 'power-burst');
  assert.ok(target); state.activeOperatorId = target.ownerId; state.conditions.values[target.templateId] = 'up';
  state.skills.launchCounts[target.instanceId] = target.skill.params.everyTurns - 1;
  let multiplier; const physics = { restore() {}, launch(_command, value) { multiplier = value; } };
  const match = new LocalMatch(state, physics, config);
  assert.equal(match.execute({ type: 'Launch', commandId: 'burst-condition', matchId: state.matchId,
    turnNumber: 1, operatorId: target.ownerId, playerId: target.instanceId, direction: { x: 1, y: 0 }, power: 1 }, target.ownerId).ok, true);
  assert.equal(multiplier, target.skill.params.multiplier * conditionPowerMultiplier(target, state, config));
  assert.equal(match.getSnapshot().skills.launchCounts[target.instanceId], 0);
});
