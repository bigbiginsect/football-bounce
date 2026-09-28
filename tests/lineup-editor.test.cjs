const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LineupEditor } = require('../.test-output/application/LineupEditor.js');
const { formationPositions } = require('../.test-output/core/Lineup.js');
const { parsePlayerCatalog } = require('../.test-output/core/PlayerCatalog.js');
const { freezeConfig, prototypeConfig, createStandardMatchState } =
  require('../.test-output/core/PrototypeConfig.js');

const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
const config = freezeConfig(prototypeConfig);

test('候补替换后原球员回仓，且两队选择互不影响', () => {
  const editor = new LineupEditor(catalog, config);
  const before = editor.getSnapshot();
  assert.deepEqual(before.bench, ['haaland']);
  assert.equal(editor.execute({ type: 'ReplaceFromBench', templateId: 'haaland', slot: 0 }), true);
  const after = editor.getSnapshot();
  assert.equal(after.blue[0], 'haaland');
  assert.deepEqual(after.bench, ['van-dijk']);
  assert.deepEqual(after.red, before.red);
  assert.equal(editor.execute({ type: 'ReplaceFromBench', templateId: 'haaland', slot: 1 }), false);
  assert.equal(editor.execute({ type: 'ReplaceFromBench', templateId: 'missing', slot: 1 }), false);
  assert.equal(editor.execute({ type: 'ReplaceFromBench', templateId: 'van-dijk', slot: 5 }), false);
});

test('场上球员交换槽位，确认流程保留选择并输出合法比赛阵容', () => {
  const editor = new LineupEditor(catalog, config);
  assert.equal(editor.execute({ type: 'SwapSlots', from: 0, to: 4 }), true);
  assert.equal(editor.execute({ type: 'SwapSlots', from: 0, to: 0 }), false);
  assert.equal(editor.execute({ type: 'SwapSlots', from: -1, to: 1 }), false);
  assert.throws(() => editor.toMatchLineups(), /尚未确认/);
  assert.equal(editor.execute({ type: 'ConfirmSide' }), true);
  assert.equal(editor.getSnapshot().side, 'red');
  assert.equal(editor.execute({ type: 'BackToBlue' }), true);
  assert.equal(editor.getSnapshot().blue[0], 'mbappe');
  assert.equal(editor.execute({ type: 'ConfirmSide' }), true);
  assert.equal(editor.execute({ type: 'ReplaceFromBench', templateId: 'haaland', slot: 2 }), true);
  assert.equal(editor.execute({ type: 'ConfirmSide' }), true);
  const chosen = editor.toMatchLineups();
  assert.equal(chosen.blue[0].templateId, 'mbappe');
  assert.deepEqual(chosen.blue[0].position, { x: -1.6, y: -3.8 });
  assert.equal(chosen.red[2].templateId, 'haaland');
  assert.deepEqual(chosen.red[2].position, { x: 0, y: 3 });
  assert.equal(editor.execute({ type: 'SwapSlots', from: 0, to: 1 }), false);
  const match = createStandardMatchState('chosen', config, 17, catalog, chosen);
  assert.equal(match.players[0].templateId, 'mbappe');
  assert.equal(match.players[7].templateId, 'haaland');
  assert.deepEqual(match.kickoff.players[7].position, { x: 0, y: 3 });
});

test('双方阵型分别保存、改变开局坐标，并能从已确认阵容恢复', () => {
  const editor = new LineupEditor(catalog, config);
  const bluePlayers = [...editor.getSnapshot().blue];
  assert.equal(editor.getSnapshot().formationId, '2-1-2');
  assert.equal(editor.execute({ type: 'SelectFormation', formationId: '2-2-1' }), true);
  assert.deepEqual(editor.getSnapshot().blue, bluePlayers);
  assert.equal(editor.execute({ type: 'SelectFormation', formationId: 'missing' }), false);
  assert.equal(editor.execute({ type: 'ConfirmSide' }), true);
  assert.equal(editor.getSnapshot().formationId, '2-1-2');
  assert.equal(editor.execute({ type: 'SelectFormation', formationId: '1-2-2' }), true);
  assert.equal(editor.execute({ type: 'ConfirmSide' }), true);
  const chosen = editor.toMatchLineups();
  assert.deepEqual(chosen.blue.map(item => item.position), formationPositions('2-2-1', 'blue'));
  assert.deepEqual(chosen.red.map(item => item.position), formationPositions('1-2-2', 'red'));
  const reopened = new LineupEditor(catalog, config, chosen);
  assert.equal(reopened.getSnapshot().formationId, '2-2-1');
  reopened.execute({ type: 'ConfirmSide' });
  assert.equal(reopened.getSnapshot().formationId, '1-2-2');
});
