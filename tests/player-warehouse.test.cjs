const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PlayerWarehouse } = require('../.test-output/application/PlayerWarehouse.js');
const { LineupEditor } = require('../.test-output/application/LineupEditor.js');
const { parsePlayerCatalog } = require('../.test-output/core/PlayerCatalog.js');
const { freezeConfig, prototypeConfig } = require('../.test-output/core/PrototypeConfig.js');

const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
const config = freezeConfig(prototypeConfig);

test('仓库选择槽位后上场，原球员回到候补且无效操作不修改阵容', () => {
  const lineups = new LineupEditor(catalog, config);
  const warehouse = new PlayerWarehouse(catalog, lineups);
  const before = warehouse.getSnapshot();
  assert.equal(before.side, 'blue'); assert.equal(before.selectedSlot, 0);
  assert.deepEqual(before.players, catalog.players.map(player => player.id));
  assert.equal(warehouse.execute({ type: 'SelectSlot', slot: 3 }), true);
  assert.equal(warehouse.execute({ type: 'DeployPlayer', templateId: 'haaland' }), true);
  const after = warehouse.getSnapshot();
  assert.equal(after.selectedSlot, 3); assert.equal(after.active[3], 'haaland');
  assert.ok(lineups.getSnapshot().bench.includes('messi'));
  assert.equal(warehouse.execute({ type: 'DeployPlayer', templateId: 'haaland' }), false);
  assert.equal(warehouse.execute({ type: 'DeployPlayer', templateId: 'missing' }), false);
  assert.equal(warehouse.execute({ type: 'SelectSlot', slot: 5 }), false);
  assert.deepEqual(warehouse.getSnapshot(), after);
});

test('蓝红两队分别保留仓库选中槽位和上阵结果', () => {
  const lineups = new LineupEditor(catalog, config);
  const warehouse = new PlayerWarehouse(catalog, lineups);
  warehouse.execute({ type: 'SelectSlot', slot: 4 });
  warehouse.execute({ type: 'DeployPlayer', templateId: 'haaland' });
  lineups.execute({ type: 'ConfirmSide' });
  assert.equal(warehouse.getSnapshot().side, 'red');
  assert.equal(warehouse.getSnapshot().selectedSlot, 0);
  warehouse.execute({ type: 'SelectSlot', slot: 1 });
  warehouse.execute({ type: 'DeployPlayer', templateId: 'haaland' });
  assert.equal(warehouse.getSnapshot().active[1], 'haaland');
  lineups.execute({ type: 'BackToBlue' });
  const blue = warehouse.getSnapshot();
  assert.equal(blue.selectedSlot, 4); assert.equal(blue.active[4], 'haaland');
});

test('仓库阵型命令更新当前队站位，不改变球员顺序和所选槽位', () => {
  const lineups = new LineupEditor(catalog, config);
  const warehouse = new PlayerWarehouse(catalog, lineups);
  warehouse.execute({ type: 'SelectSlot', slot: 3 });
  const before = warehouse.getSnapshot();
  assert.equal(before.formationId, '2-1-2');
  assert.deepEqual(before.formations.map(item => item.id), ['2-1-2', '2-2-1', '1-2-2']);
  assert.equal(warehouse.execute({ type: 'SelectFormation', formationId: '2-2-1' }), true);
  const changed = warehouse.getSnapshot();
  assert.equal(changed.formationId, '2-2-1'); assert.equal(changed.selectedSlot, 3);
  assert.deepEqual(changed.active, before.active); assert.notDeepEqual(changed.slotPositions, before.slotPositions);
  assert.equal(warehouse.execute({ type: 'SelectFormation', formationId: 'missing' }), false);
  lineups.execute({ type: 'ConfirmSide' });
  assert.equal(warehouse.getSnapshot().formationId, '2-1-2');
});
