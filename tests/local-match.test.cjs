const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');

// 夹具数值不代表首版人数、局时或先手决定。
const body = () => ({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });
function fixture(overrides = {}) {
  return { schemaVersion: 5, revision: 0, matchId: 'test-match', modeId: 'test', configVersion: 'fixture-1',
    catalogVersion: 'test-catalog',
    turnNumber: 1, phase: 'Aiming', activeOperatorId: 'a', clock: { matchDurationMs: 1000,
      elapsedMs: 0, remainingMs: 1000, turnDurationMs: 1000, turnRemainingMs: 1000 },
    random: { seed: 1, state: 1, firstOperatorId: 'a' },
    score: { a: 0, b: 0 }, players: [
      { ...body(), instanceId: 'a1', templateId: 'test-player', ownerId: 'a' },
      { ...body(), instanceId: 'b1', templateId: 'test-player', ownerId: 'b' },
    ], ball: body(), kickoff: { players: [
      { instanceId: 'a1', position: { x: 0, y: 0 } }, { instanceId: 'b1', position: { x: 0, y: 0 } },
    ], ballPosition: { x: 0, y: 0 }, pending: false },
    skills: { launchCounts: {}, aimWobble: null, bonus: null, forcedPlayerId: null },
    result: null, ...overrides };
}
function command(overrides = {}) {
  return { type: 'Launch', commandId: 'c1', matchId: 'test-match', turnNumber: 1,
    operatorId: 'a', playerId: 'a1', direction: { x: 1, y: 0 }, power: 0.5, ...overrides };
}
test('合法发射经入口转入模拟，记录命令，不自行移动或计分', () => {
  const initial = fixture(); const match = new LocalMatch(initial);
  assert.deepEqual(match.execute(command(), 'a'), { ok: true, revision: 1 });
  assert.deepEqual(match.getSnapshot(), { ...initial, revision: 1, phase: 'Simulating' });
  assert.deepEqual(match.getAcceptedCommands(), [command()]);
});
for (const [name, input, session, reason] of [
  ['伪造会话身份', command(), 'b', 'IdentityMismatch'],
  ['错误对局', command({ matchId: 'other' }), 'a', 'WrongMatch'],
  ['过期回合', command({ turnNumber: 0 }), 'a', 'InvalidCommand'],
  ['未来回合', command({ turnNumber: 2 }), 'a', 'WrongTurn'],
  ['非行动方', command({ operatorId: 'b', playerId: 'b1' }), 'b', 'WrongOperator'],
  ['对方球员', command({ playerId: 'b1' }), 'a', 'WrongPlayer'],
  ['未知球员', command({ playerId: 'missing' }), 'a', 'WrongPlayer'],
  ['缺失载荷', null, 'a', 'InvalidCommand'],
  ['未知类型', command({ type: 'Score' }), 'a', 'InvalidCommand'],
]) test(`拒绝${name}且不修改状态`, () => {
  const match = new LocalMatch(fixture()); const before = match.getSnapshot();
  assert.deepEqual(match.execute(input, session), { ok: false, reason });
  assert.deepEqual(match.getSnapshot(), before); assert.deepEqual(match.getAcceptedCommands(), []);
});
test('重复命令优先拒绝，模拟中拒绝新发射', () => {
  const match = new LocalMatch(fixture()); match.execute(command(), 'a');
  assert.equal(match.execute(command(), 'a').reason, 'DuplicateCommand');
  assert.equal(match.execute(command({ commandId: 'c2' }), 'a').reason, 'WrongPhase');
  assert.equal(match.getSnapshot().revision, 1);
});
test('已有回合的过期命令被拒绝', () => {
  assert.equal(new LocalMatch(fixture({ turnNumber: 2 })).execute(command(), 'a').reason, 'WrongTurn');
});
test('忽略额外载荷，不接受客户端自报比分或非 JSON 数据', () => {
  const match = new LocalMatch(fixture());
  const input = command({ score: { a: 99 } }); input.extra = input;
  assert.equal(match.execute(input, 'a').ok, true);
  assert.equal(match.getSnapshot().score.a, 0);
  assert.deepEqual(match.getAcceptedCommands(), [command()]);
});
for (const phase of ['Simulating', 'Resolving', 'Finished']) test(`${phase} 阶段不能发射`, () => {
  assert.equal(new LocalMatch(fixture({ phase })).execute(command(), 'a').reason, 'WrongPhase');
});
test('拒绝非有限数值、零/非单位方向和越界力度', () => {
  for (const power of [NaN, Infinity, -1, 0, 1.01, '1']) {
    assert.equal(new LocalMatch(fixture()).execute(command({ power }), 'a').reason, 'InvalidCommand');
  }
  for (const direction of [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: NaN, y: 0 }, { x: 1, y: Infinity }, null]) {
    assert.equal(new LocalMatch(fixture()).execute(command({ direction }), 'a').reason, 'InvalidCommand');
  }
  assert.equal(new LocalMatch(fixture()).execute(command({ power: 1 }), 'a').ok, true);
});
test('状态/命令可 JSON 往返，调用方无法通过引用修改权威数据', () => {
  const initial = fixture(); const match = new LocalMatch(initial); initial.score.a = 99;
  const input = command(); match.execute(input, 'a'); input.direction.x = 99;
  const snapshot = match.getSnapshot(); snapshot.players[0].position.x = 99;
  const commands = match.getAcceptedCommands(); commands[0].direction.x = 88;
  assert.equal(match.getSnapshot().score.a, 0);
  assert.equal(match.getSnapshot().players[0].position.x, 0);
  assert.equal(match.getAcceptedCommands()[0].direction.x, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(match.getSnapshot())), match.getSnapshot());
  assert.deepEqual(JSON.parse(JSON.stringify(match.getAcceptedCommands())), [command()]);
});
