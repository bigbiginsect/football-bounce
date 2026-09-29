const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 加载真实表现层代码，只替换引擎边界，覆盖以前纯规则测试没有走到的事件处理链。
const cache = new Map();
class Vec3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
class Color {
  constructor(r = 255, g = 255, b = 255, a = 255) { this.r = r; this.g = g; this.b = b; this.a = a; }
  static WHITE = new Color();
}
const cc = { _decorator: { ccclass: () => target => target },
  Component: class { enabledInHierarchy = true; }, Vec3, Color,
  AudioClip: class {}, AudioSource: class { stop() {} playOneShot() {} },
  tween: target => { let values; let done; return {
    to(_duration, next) { values = next; return this; }, call(callback) { done = callback; return this; },
    start() { if (values?.position) target.setPosition(values.position.x, values.position.y); done?.(); },
  }; },
  isValid: (node, strict) => node.valid && (!strict || !node.destroying) };
function load(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {}; cache.set(filename, exports);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
  } }).outputText;
  const requireLocal = name => {
    if (name === 'cc') return cc;
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
    throw new Error(`Unexpected import ${name}`);
  };
  vm.runInNewContext(source, { exports, require: requireLocal, console }, { filename });
  return exports;
}
const { Boot } = load('assets/scripts/presentation/Boot.ts');
const { PrototypeView } = load('assets/scripts/presentation/PrototypeView.ts');
const { LineupView } = load('assets/scripts/presentation/LineupView.ts');
const { PlayerWarehouseView } = load('assets/scripts/presentation/PlayerWarehouseView.ts');
const { CocosPhysics } = load('assets/scripts/adapters/physics/CocosPhysics.ts');
const { MatchFeedbackTracker, matchClock, overlayFor } =
  load('assets/scripts/presentation/MatchFeedback.ts');
const { LocalMatch } = load('assets/scripts/application/LocalMatch.ts');
const { LaunchGesture } = load('assets/scripts/core/LaunchGesture.ts');
const { prototypeConfig, freezeConfig, createPrototypeState, createStandardMatchState } =
  load('assets/scripts/core/PrototypeConfig.ts');
const { parsePlayerCatalog, playerGameplayValues, getPlayerTemplate } =
  load('assets/scripts/core/PlayerCatalog.ts');
const config = freezeConfig(prototypeConfig);
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
function lineupGestureFixture() {
  const view = Object.create(LineupView.prototype);
  view.snapshot = { side: 'blue', blue: ['van-dijk', 'cristiano-ronaldo', 'de-bruyne', 'messi', 'mbappe'],
    red: [], bench: ['haaland'], formationId: '2-1-2' };
  view.slotPoints = [{ x: -132, y: -150 }, { x: 132, y: -150 }, { x: 0, y: -6 },
    { x: -132, y: 138 }, { x: 132, y: 138 }];
  view.root = { children: [] };
  view.scrollOffset = 0;
  view.benchCards = [{ position: { x: -234, y: 0 }, setPosition(x, y) { this.position = { x, y }; } }];
  view.targetRing = { clear() {}, roundRect() {}, stroke() {} };
  view.local = point => point;
  view.playerCard = () => ({ setPosition() {}, setSiblingIndex() {}, destroy() {} });
  const edits = []; view.submit = edit => edits.push(edit);
  return { view, edits };
}
test('仓库向球场拖入提交替换，空白落点与第二触点不提交', () => {
  const { view, edits } = lineupGestureFixture();
  view.touchStart(1, { x: -234, y: -423 });
  view.touchStart(2, { x: -234, y: -423 });
  view.touchMove(2, { x: -132, y: -15 });
  view.touchEnd(2, { x: -132, y: -15 });
  assert.equal(edits.length, 0);
  view.touchMove(1, { x: -132, y: -15 });
  view.touchEnd(1, { x: -132, y: -15 });
  assert.deepEqual(JSON.parse(JSON.stringify(edits)), [{ type: 'ReplaceFromBench', templateId: 'haaland', slot: 0 }]);
  view.touchStart(1, { x: -234, y: -423 });
  view.touchMove(1, { x: 300, y: 350 });
  view.touchEnd(1, { x: 300, y: 350 });
  assert.equal(edits.length, 1);
});
test('场上拖动互换，取消触摸不会改阵容', () => {
  const { view, edits } = lineupGestureFixture();
  view.touchStart(1, { x: -132, y: -15 });
  view.touchMove(1, { x: 132, y: -15 });
  view.touchCancel(1);
  view.touchEnd(1, { x: 132, y: -15 });
  assert.equal(edits.length, 0);
  view.touchStart(1, { x: -132, y: -15 });
  view.touchMove(1, { x: 132, y: -15 });
  view.touchEnd(1, { x: 132, y: -15 });
  assert.deepEqual(JSON.parse(JSON.stringify(edits)), [{ type: 'SwapSlots', from: 0, to: 1 }]);
});
test('仓库球员增加后可横向滚动，滑动不触发替换', () => {
  const { view, edits } = lineupGestureFixture();
  view.snapshot.bench = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  view.benchCards = view.snapshot.bench.map((_, i) => ({
    position: { x: -234 + i * 154, y: 0 },
    setPosition(x, y) { this.position = { x, y }; },
  }));
  view.touchStart(1, { x: -234, y: -423 });
  view.touchMove(1, { x: -300, y: -424 });
  view.touchMove(1, { x: -300, y: -424 });
  view.touchEnd(1, { x: -300, y: -424 });
  assert.ok(view.scrollOffset > 0);
  assert.equal(edits.length, 0);
});
test('阵容页顶部或左边缘右滑达到阈值进入球员仓库，短滑回弹', () => {
  const view = Object.create(LineupView.prototype); const progress = []; const complete = [];
  view.local = point => point; view.navigationPoint = point => point;
  view.navigation = { previewWarehouse: value => progress.push(value),
    finishWarehouse: value => complete.push(value) };
  view.touchStart(1, { x: -220, y: 500 });
  view.touchMove(1, { x: -20, y: 505 });
  view.touchEnd(1, { x: -20, y: 505 });
  assert.ok(progress.at(-1) > 0.27); assert.deepEqual(complete, [true]);
  view.touchStart(2, { x: -220, y: 500 });
  view.touchMove(2, { x: -180, y: 502 });
  view.touchEnd(2, { x: -180, y: 502 });
  assert.deepEqual(complete, [true, false]);
  view.touchStart(3, { x: -320, y: 0 });
  view.touchMove(3, { x: -150, y: 2 });
  view.touchEnd(3, { x: -150, y: 2 });
  assert.deepEqual(complete, [true, false, true]);
});
function warehouseGestureFixture() {
  const view = Object.create(PlayerWarehouseView.prototype); const commands = []; const back = [];
  view.local = point => point; view.navigationPoint = point => point;
  view.submit = command => commands.push(command);
  view.navigation = { previewBack: progress => { view.preview = progress; }, finishBack: value => back.push(value) };
  view.infoPanel = undefined; view.scrollOffset = 0; view.drawerProgress = 0; view.drawerAnimating = false;
  view.formationFocused = false;
  view.drawer = { position: { x: 0, y: -420 }, setPosition(x, y) { this.position = { x, y }; } };
  view.drawerHint = { string: '' }; view.viewport = { position: { x: 0, y: 0 } };
  view.compactFormation = { active: true }; view.focusedFormation = { active: false };
  view.snapshot = { slotPositions: [{ x: -1.6, y: -3.8 }, { x: 1.6, y: -3.8 }, { x: 0, y: -3 },
    { x: -1.25, y: -2 }, { x: 1.25, y: -2 }] };
  view.formationButtons = [{ id: '2-2-1', node: { position: { x: 0, y: 472 } } }];
  view.activeCards = [{ slot: 2, node: { position: { x: 0, y: 312 },
    setPosition(x, y) { this.position = { x, y }; } } }];
  view.playerCards = [{ id: 'haaland', node: { position: { x: -158, y: 350 },
    setPosition(x, y) { this.position = { x, y }; } } }];
  view.maxScroll = () => 220; view.placeCards = PlayerWarehouseView.prototype.placeCards.bind(view);
  view.snapDrawer = expanded => { view.snapped = expanded; view.setDrawerProgress(expanded ? 1 : 0); };
  return { view, commands, back };
}
test('仓库阵型、槽位、信息和上场按钮产生明确意图', () => {
  const { view, commands } = warehouseGestureFixture(); let info;
  view.showInfo = id => { info = id; };
  view.touchStart(1, { x: 0, y: 472 }); view.touchEnd(1, { x: 0, y: 472 });
  assert.equal(view.formationFocused, true); assert.equal(view.compactFormation.active, false);
  assert.equal(view.focusedFormation.active, true); assert.equal(view.drawer.position.y, -890);
  assert.equal(view.activeCards[0].node.position.y, 70);
  view.touchStart(2, { x: 0, y: 70 }); view.touchEnd(2, { x: 0, y: 70 });
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [
    { type: 'SelectFormation', formationId: '2-2-1' }, { type: 'SelectSlot', slot: 2 },
  ]);
  // 阵型聚焦态第一张卡按钮的根坐标分别为 (-230, -608) 与 (-86, -608)。
  view.touchStart(3, { x: -230, y: -608 }); view.touchEnd(3, { x: -230, y: -608 });
  assert.equal(info, 'haaland');
  view.touchStart(4, { x: -86, y: -608 }); view.touchEnd(4, { x: -86, y: -608 });
  assert.deepEqual(JSON.parse(JSON.stringify(commands.at(-1))),
    { type: 'DeployPlayer', templateId: 'haaland' });
});
test('仓库顶部或右边缘左滑和返回按钮关闭页面，纵向拖动只滚动列表', () => {
  const { view, commands, back } = warehouseGestureFixture();
  view.touchStart(1, { x: 150, y: 580 }); view.touchMove(1, { x: -30, y: 576 });
  view.touchEnd(1, { x: -30, y: 576 });
  assert.ok(view.preview > 0.24); assert.deepEqual(back, [true]);
  view.touchStart(2, { x: -286, y: 592 }); view.touchEnd(2, { x: -286, y: 592 });
  assert.deepEqual(back, [true, true]);
  view.touchStart(4, { x: 340, y: 0 }); view.touchMove(4, { x: 160, y: -2 });
  view.touchEnd(4, { x: 160, y: -2 });
  assert.deepEqual(back, [true, true, true]);
  view.playerCards = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`,
    node: { position: { x: index % 2 ? 158 : -158, y: 350 - Math.floor(index / 2) * 220 },
      setPosition(x, y) { this.position = { x, y }; } } }));
  view.touchStart(3, { x: 0, y: -100 }); view.touchMove(3, { x: 0, y: 50 });
  view.touchEnd(3, { x: 0, y: 50 });
  assert.ok(view.scrollOffset > 0); assert.equal(commands.length, 0);
});
test('仓库抽屉上拉跟手展开、下拉恢复，过程不提交球员命令', () => {
  const { view, commands, back } = warehouseGestureFixture();
  view.touchStart(1, { x: 0, y: 130 });
  view.touchMove(1, { x: 0, y: 450 });
  assert.ok(view.drawerProgress > 0.8); assert.ok(view.drawer.position.y > -120);
  view.touchEnd(1, { x: 0, y: 450 });
  assert.equal(view.snapped, true); assert.equal(view.drawerProgress, 1);
  view.touchStart(2, { x: 0, y: 520 });
  view.touchMove(2, { x: 0, y: 250 });
  view.touchEnd(2, { x: 0, y: 250 });
  assert.equal(view.snapped, false); assert.equal(view.drawerProgress, 0);
  assert.equal(commands.length, 0); assert.equal(back.length, 0);
});
test('点击阵型后仓库停靠到下方约四分之一，仍可上拉全屏并下拉恢复聚焦布局', () => {
  const { view, commands } = warehouseGestureFixture();
  view.touchStart(1, { x: 0, y: 472 }); view.touchEnd(1, { x: 0, y: 472 });
  assert.equal(view.drawerTop(), -300);
  view.touchStart(2, { x: 0, y: -340 }); view.touchMove(2, { x: 0, y: 500 });
  view.touchEnd(2, { x: 0, y: 500 });
  assert.equal(view.drawerProgress, 1); assert.equal(view.drawerTop(), 548);
  view.touchStart(3, { x: 0, y: 520 }); view.touchMove(3, { x: 0, y: -250 });
  view.touchEnd(3, { x: 0, y: -250 });
  assert.equal(view.drawerProgress, 0); assert.equal(view.drawerTop(), -300);
  assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ type: 'SelectFormation', formationId: '2-2-1' }]);
});
test('球员信息页的顶部关闭键和底部返回按钮都只产生关闭意图', () => {
  const { view, commands, back } = warehouseGestureFixture(); let closed = 0;
  view.closeInfo = () => { closed++; view.infoPanel = undefined; };
  view.infoPanel = {};
  view.touchStart(1, { x: 296, y: 535 }); view.touchEnd(1, { x: 296, y: 535 });
  assert.equal(closed, 1);
  view.infoPanel = {};
  view.touchStart(2, { x: 0, y: -500 }); view.touchEnd(2, { x: 0, y: -500 });
  assert.equal(closed, 2);
  view.infoPanel = {};
  view.touchStart(3, { x: 0, y: 0 }); view.touchEnd(3, { x: 0, y: 0 });
  assert.equal(closed, 2);
  assert.equal(commands.length, 0); assert.equal(back.length, 0);
});
test('球员信息页综合分只读派生自现有五项评分', () => {
  const view = Object.create(PlayerWarehouseView.prototype);
  assert.equal(view.overall({ weight: 55, power: 84, precision: 96, mentality: 96, curve: 98 }), 86);
  assert.equal(view.overall({ weight: 95, power: 77, precision: 78, mentality: 95, curve: 72 }), 83);
});
function setup() {
  const boot = new Boot(); boot.config = config; boot.gesture = new LaunchGesture(config);
  const physics = { restore(state) { this.state = state; }, launch() {}, step() {}, stop() {},
    sample() { return { players: this.state.players, ball: this.state.ball, goal: null }; } };
  boot.match = new LocalMatch(createPrototypeState('input-regression', config, 'normal'), physics, config);
  const rendered = []; boot.screen = { toField: point => point, render: (...args) => rendered.push(args) };
  const event = (x = 0, y = -2.5, id = 1) => ({ getID: () => id, getLocation: () => ({ x, y }),
    getUILocation: () => { throw new Error('不能将 UI 缩放坐标当作屏幕坐标'); } });
  return { boot, event, rendered };
}
test('停止后的首次按下立即开始下一次拖动，无需额外帧或重试', () => {
  const { boot, event } = setup();
  boot.beginTouch(event()); boot.endTouch(event(0, -3.5));
  for (let i = 0; i < 18; i++) boot.match.advance(config.fixedStep);
  assert.equal(boot.match.getSimulationStatus().reason, 'stopped');
  boot.beginTouch(event(0.7, 1)); boot.moveTouch(event(0.7, 0.5));
  assert.ok(boot.gesture.preview().aim);
  boot.endTouch(event(0.7, 0.5));
  assert.equal(boot.match.getAcceptedCommands().length, 2);
  assert.equal(boot.match.getSnapshot().phase, 'Simulating');
});
test('blur 后缺少 focus 事件：首个真实按下同时恢复并选人，不吞掉第一次拖动', () => {
  const { boot, event, rendered } = setup();
  boot.pause(); assert.equal(boot.paused, true);
  assert.match(rendered.at(-1)[2], /已暂停/);
  boot.beginTouch(event()); assert.equal(boot.paused, false);
  boot.moveTouch(event(0, -3)); assert.ok(boot.gesture.preview().aim);
  boot.endTouch(event(0, -3)); assert.equal(boot.match.getAcceptedCommands().length, 1);
});
test('后台与停用仍禁止输入，前台恢复后第一次拖动有效', () => {
  const { boot, event } = setup();
  boot.hide(); boot.resume(); boot.beginTouch(event());
  assert.equal(boot.paused, true); assert.equal(boot.gesture.preview(), null);
  boot.show(); boot.enabledInHierarchy = false; boot.beginTouch(event());
  assert.equal(boot.gesture.preview(), null);
  boot.enabledInHierarchy = true; boot.beginTouch(event()); assert.ok(boot.gesture.preview());
});
test('运动中按下不延迟发射，第二触点不能结束当前拖动', () => {
  const { boot, event } = setup();
  boot.beginTouch(event()); boot.endTouch(event(0, -3, 2)); assert.ok(boot.gesture.preview());
  boot.endTouch(event(0, -3)); boot.beginTouch(event());
  assert.equal(boot.gesture.preview(), null);
  assert.equal(boot.match.getAcceptedCommands().length, 1);
});
test('触点转换使用渲染相机，适应视口偏移和不同缩放', () => {
  for (const scale of [0.5, 1, 1.5]) {
    const screen = Object.create(PrototypeView.prototype);
    screen.camera = { screenToWorld: p => new Vec3((p.x - 37) / scale, (p.y - 81) / scale, 0) };
    screen.field = { convertToNodeSpaceAR: p => new Vec3(p.x - 360, p.y - 640, 0) };
    const actual = screen.toField({ x: (360 + 1.25 * 80) * scale + 37, y: (640 - 2.5 * 80) * scale + 81 });
    assert.equal(actual.x, 1.25); assert.equal(actual.y, -2.5);
  }
});
function viewFixture() {
  const screen = Object.create(PrototypeView.prototype); screen.config = config;
  const ballPaths = []; const ballFills = []; const bodyCircles = [];
  screen.bodies = { clear() { ballPaths.length = 0; ballFills.length = 0; bodyCircles.length = 0; },
    circle(x, y, radius) { bodyCircles.push({ x, y, radius }); },
    moveTo(x, y) { ballPaths.push([x, y]); }, lineTo(x, y) { ballPaths.push([x, y]); },
    fill() { ballFills.push(this.fillColor); }, stroke() {} };
  screen.status = {}; screen.info = {};
  screen.score = {}; screen.clock = {};
  screen.activeRestartButton = { active: true };
  screen.eventPanel = { active: false }; screen.eventTitle = {}; screen.eventDetail = {};
  screen.resultPanel = { active: false }; screen.resultTitle = {}; screen.resultScore = {};
  const circles = [];
  screen.powerCircle = { clear() { circles.length = 0; }, circle(x, y, radius) { circles.push({ x, y, radius }); }, fill() {} };
  const lines = []; const aimStrokes = []; let currentPath = [];
  screen.aim = { clear() { lines.length = 0; aimStrokes.length = 0; currentPath = []; },
    moveTo(x, y) { lines.push([x, y]); currentPath.push([x, y]); },
    lineTo(x, y) { lines.push([x, y]); currentPath.push([x, y]); },
    stroke() { aimStrokes.push({ points: currentPath, color: this.strokeColor, lineWidth: this.lineWidth }); currentPath = []; } };
  const state = createPrototypeState('view', config, 'normal');
  return { screen, state, lines, aimStrokes, circles, ballPaths, ballFills, bodyCircles };
}
test('立体足球图案随物理角度旋转，中心黑块、外围黑块与非对称标记保留', () => {
  const { screen, state, ballPaths, ballFills } = viewFixture();
  screen.render(state, null, '', '', 0);
  const first = ballPaths[0];
  assert.equal(ballFills.filter(color => color.r === 25).length, 6);
  assert.ok(ballFills.some(color => color.r === 203));
  assert.ok(ballFills.some(color => color.r === 248));
  assert.ok(ballFills.some(color => color.r === 255 && color.g === 183));
  screen.render(state, null, '', '', 90);
  const rotated = ballPaths[0];
  assert.ok(Math.hypot(first[0] - rotated[0], first[1] - rotated[1]) > 3);
  assert.equal(ballFills.filter(color => color.r === 25).length, 6);
});
test('皮球落地阴影拖在平动方向后方，平动与自转视觉来源独立', () => {
  const { screen, state, bodyCircles } = viewFixture();
  const ballCircleIndex = state.players.length;
  screen.render(state, null, '', '', 0);
  const restShadow = { ...bodyCircles[ballCircleIndex] };
  const moving = { ...state, ball: { ...state.ball, velocity: { x: 6, y: 0 } } };
  screen.render(moving, null, '', '', 0);
  const movingShadow = bodyCircles[ballCircleIndex];
  assert.ok(movingShadow.x < restShadow.x);
  assert.equal(movingShadow.y, restShadow.y);
});
test('球面黑块打破 72 度重复，高速旋转不会把正转 60 度误认成反转 12 度', () => {
  const { screen, state, ballPaths } = viewFixture();
  const signature = () => Array.from({ length: 5 }, (_, panel) => {
    const vertices = ballPaths.slice(6 + panel * 8, 11 + panel * 8);
    const cx = vertices.reduce((sum, point) => sum + point[0], 0) / 5;
    const cy = vertices.reduce((sum, point) => sum + point[1], 0) / 5;
    return [cx, cy, Math.hypot(vertices[0][0] - cx, vertices[0][1] - cy)]
      .map(value => Math.round(value * 100) / 100).join(',');
  }).sort();
  screen.render(state, null, '', '', 0); const initial = signature();
  screen.render(state, null, '', '', 72); assert.notDeepEqual(signature(), initial);
  screen.render(state, null, '', '', 360); assert.deepEqual(signature(), initial);
});
test('物理适配层限制线速度时不改写皮球自旋', () => {
  const physics = Object.create(CocosPhysics.prototype); physics.config = config;
  const body = spin => ({ angularVelocity: spin, linearVelocity: { length: () => 0 } });
  const player = body(0); const ball = body(100);
  physics.bodies = new Map([['a1', player], ['ball', ball]]);
  physics.limitSpeeds(); assert.equal(ball.angularVelocity, 100);
  ball.angularVelocity = -100; physics.limitSpeeds();
  assert.equal(ball.angularVelocity, -100);
  assert.equal(player.angularVelocity, 0);
});
test('碰撞冲量只供表现层消费，读取后清零', () => {
  const physics = Object.create(CocosPhysics.prototype); physics.strongestImpact = 0;
  physics.recordImpact(null, null, { getImpulse: () => ({ normalImpulses: [0.12, -0.38], tangentImpulses: [] }) });
  physics.recordImpact(null, null, { getImpulse: () => ({ normalImpulses: [0.2], tangentImpulses: [] }) });
  assert.equal(physics.consumeStrongestImpact(), 0.38);
  assert.equal(physics.consumeStrongestImpact(), 0);
  physics.recordImpact(null, null, { getImpulse: () => null });
  assert.equal(physics.consumeStrongestImpact(), 0);
});
test('物理接触回调只采集皮球碰到的球员并在同一步去重', () => {
  const physics = Object.create(CocosPhysics.prototype);
  physics.bodies = new Map([['a1', {}], ['b1', {}], ['ball', {}]]);
  physics.ballPlayerContacts = new Set();
  const collider = name => ({ node: { name } });
  physics.recordBallPlayerContact(collider('ball'), collider('a1'));
  physics.recordBallPlayerContact(collider('a1'), collider('ball'));
  physics.recordBallPlayerContact(collider('ball'), collider('Boundary'));
  physics.recordBallPlayerContact(collider('a1'), collider('b1'));
  assert.deepEqual([...physics.ballPlayerContacts], ['a1']);
});
test('反馈跟踪器对进球、开球违例、瞄准超时和终局各只发出一次事件', () => {
  const initial = createStandardMatchState('feedback', config, 7, catalog);
  const tracker = new MatchFeedbackTracker(); tracker.reset(initial);
  const other = initial.activeOperatorId === 'blue' ? 'red' : 'blue';
  const goal = { ...initial, revision: initial.revision + 1, turnNumber: 2, activeOperatorId: other,
    score: { ...initial.score, [initial.activeOperatorId]: 1 } };
  let events = tracker.observe(goal, 'goal');
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'goal', scorer: initial.activeOperatorId,
    score: { blue: goal.score.blue, red: goal.score.red } }]);
  assert.equal(tracker.observe(goal, 'goal').length, 0);
  const timeout = { ...goal, revision: goal.revision + 1, turnNumber: 3,
    activeOperatorId: initial.activeOperatorId };
  events = tracker.observe(timeout, 'turn-timeout');
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'turn-timeout',
    expiredSide: other, activeSide: initial.activeOperatorId }]);
  assert.equal(tracker.observe(timeout, 'turn-timeout').length, 0);
  const violation = { ...timeout, revision: timeout.revision + 1, turnNumber: 4,
    activeOperatorId: other };
  events = tracker.observe(violation, 'kickoff-violation');
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'kickoff-violation',
    violatingSide: initial.activeOperatorId, activeSide: other }]);
  assert.equal(tracker.observe(violation, 'kickoff-violation').length, 0);
  const finished = { ...violation, revision: violation.revision + 1, phase: 'Finished',
    result: { winnerId: initial.activeOperatorId, reason: 'TimeExpired' } };
  events = tracker.observe(finished, 'finished');
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [{ type: 'finished', winner: initial.activeOperatorId,
    score: { blue: finished.score.blue, red: finished.score.red } }]);
  assert.equal(tracker.observe(finished, 'finished').length, 0);
});
test('时钟和覆盖反馈文案来自状态变化结果', () => {
  assert.equal(matchClock(180000), '3:00');
  assert.equal(matchClock(59001), '1:00');
  assert.equal(matchClock(-1), '0:00');
  assert.deepEqual(JSON.parse(JSON.stringify(overlayFor({ type: 'goal', scorer: 'red',
    score: { blue: 2, red: 3 } }))), { type: 'goal', title: '红方进球！', detail: '蓝 2  :  3 红' });
  assert.deepEqual(JSON.parse(JSON.stringify(overlayFor({ type: 'turn-timeout', expiredSide: 'blue',
    activeSide: 'red' }))), { type: 'turn-timeout', title: '蓝方瞄准超时', detail: '轮到红方行动' });
  assert.deepEqual(JSON.parse(JSON.stringify(overlayFor({ type: 'kickoff-violation', violatingSide: 'blue',
    activeSide: 'red' }))), { type: 'kickoff-violation', title: '开球违例',
    detail: '蓝方开球直接入门 · 换红方开球' });
});
test('最后五秒高亮，事件覆盖层和终局面板按状态互斥显示', () => {
  const { screen, state } = viewFixture();
  const warning = { ...state, clock: { ...state.clock, turnRemainingMs: 5000 } };
  screen.render(warning, null, '蓝方行动 · 仅剩 5 秒', '第 1 回合', 0,
    { type: 'goal', title: '蓝方进球！', detail: '蓝 1 : 0 红' });
  assert.equal(screen.clock.color.r, 255);
  assert.equal(screen.eventPanel.active, true);
  assert.equal(screen.eventTitle.string, '蓝方进球！');
  const finished = { ...warning, phase: 'Finished', score: { blue: 2, red: 1 },
    result: { winnerId: 'blue', reason: 'TimeExpired' } };
  screen.render(finished, null, '比赛结束', '第 9 回合');
  assert.equal(screen.resultPanel.active, true);
  assert.equal(screen.eventPanel.active, false);
  assert.equal(screen.activeRestartButton.active, false);
  assert.equal(screen.resultTitle.string, '蓝方获胜');
  assert.match(screen.resultScore.string, /蓝 2 : 1 红/);
});
test('立体瞄准线由投影、主体和高光组成，无箭头且总长方向正确', () => {
  const { screen, state, aimStrokes } = viewFixture();
  for (const power of [0.01, 0.5, 1]) for (const direction of [{ x: 0, y: 1 }, { x: -1, y: 0 }]) {
    screen.render(state, { playerId: 'a1', aim: { direction, power } }, '', '');
    assert.equal(aimStrokes.length, 3);
    assert.deepEqual(aimStrokes.map(stroke => stroke.lineWidth), [8, 5, 2]);
    assert.ok(aimStrokes.every(stroke => stroke.points.length % 2 === 0));
    const [shadow, body, highlight] = aimStrokes;
    assert.equal(shadow.color.r, 9); assert.equal(body.color.g, 231); assert.equal(highlight.color.r, 255);
    const start = body.points[0], end = body.points.at(-1);
    assert.equal(Math.hypot(end[0] - start[0], end[1] - start[1]), config.aimLength * 80);
    assert.equal(end[0] - start[0], direction.x * config.aimLength * 80);
    assert.equal(end[1] - start[1], direction.y * config.aimLength * 80);
    assert.ok(Math.abs(Math.hypot(body.points[1][0]-start[0], body.points[1][1]-start[1])
      - config.aimDashLength*80) < 1e-8);
    assert.ok(Math.abs(Math.hypot(body.points[2][0]-body.points[1][0],
      body.points[2][1]-body.points[1][1]) - config.aimDashGap*80) < 1e-8);
  }
});
test('C 罗干扰时瞄准线按权威技能状态摆动', () => {
  const { screen, state, aimStrokes } = viewFixture();
  const wobbling = { ...state, skills: { ...state.skills, aimWobble: {
    sourcePlayerId: 'b1', targetOperatorId: 'a', amplitudeDegrees: 9,
    frequencyHz: 1.4, phaseRadians: Math.PI / 2,
  } } };
  screen.render(wobbling, { playerId: 'a1', aim: { direction: { x: 1, y: 0 }, power: 0.5 } }, '', '');
  const body = aimStrokes[1]; const start = body.points[0]; const end = body.points.at(-1);
  assert.ok(end[0] > start[0]);
  assert.ok(end[1] > start[1]);
  assert.ok(Math.abs(Math.hypot(end[0] - start[0], end[1] - start[1]) - config.aimLength * 80) < 1e-8);
});
test('浅橘黄力度圆同心、透明，随力度增大并封顶，取消后清除', () => {
  const { screen, state, circles, lines } = viewFixture();
  const radii = [];
  for (const power of [0, 0.5, 1, 2]) {
    screen.render(state, { playerId: 'a1', aim: { direction: { x: 0, y: 1 }, power } }, '', '');
    assert.equal(circles.length, 1); assert.equal(circles[0].x, 0); assert.equal(circles[0].y, -200);
    radii.push(circles[0].radius);
    assert.equal(screen.powerCircle.fillColor.r, 255);
    assert.equal(screen.powerCircle.fillColor.g, 205);
    assert.equal(screen.powerCircle.fillColor.b, 135);
    assert.equal(screen.powerCircle.fillColor.a, Math.round(config.powerCircleOpacity * 255));
  }
  assert.ok(radii[0] < radii[1] && radii[1] < radii[2]);
  assert.ok(Math.abs(radii[2] - config.powerCircleMaxRadius * 80) < 1e-9); assert.equal(radii[3], radii[2]);
  screen.render(state, { playerId: 'a1', aim: null }, '', '');
  assert.equal(circles[0].radius, config.playerRadius*80); assert.equal(lines.length, 0);
  screen.render(state, null, '', ''); assert.equal(circles.length, 0); assert.equal(lines.length, 0);
});
test('球员精度决定瞄准线长度，力量决定同一拖动力度下的力度盘上限', () => {
  const { screen, aimStrokes, circles } = viewFixture();
  screen.catalog = catalog;
  const state = createStandardMatchState('attribute-visuals', config, 9, catalog);
  const lowPower = state.players.find(player => player.templateId === 'van-dijk');
  const highPower = state.players.find(player => player.templateId === 'cristiano-ronaldo');
  const highPrecision = state.players.find(player => player.templateId === 'messi');
  const lowPrecision = state.players.find(player => player.templateId === 'mbappe');
  const radius = player => {
    screen.render(state, { playerId: player.instanceId,
      aim: { direction: { x: 0, y: 1 }, power: 0.75 } }, '', '');
    return circles[0].radius;
  };
  assert.ok(radius(highPower) > radius(lowPower));
  assert.ok(Math.abs(radius(highPower) / 80
    - (config.playerRadius + (playerGameplayValues(getPlayerTemplate(catalog, highPower.templateId), config)
      .powerCircleMaxRadius - config.playerRadius) * 0.75)) < 1e-12);
  const length = player => {
    screen.render(state, { playerId: player.instanceId,
      aim: { direction: { x: 1, y: 0 }, power: 0.5 } }, '', '');
    const points = aimStrokes[1].points;
    return Math.hypot(points.at(-1)[0] - points[0][0], points.at(-1)[1] - points[0][1]);
  };
  assert.ok(length(highPrecision) > length(lowPrecision));
  assert.ok(Math.abs(length(highPrecision) / 80
    - playerGameplayValues(getPlayerTemplate(catalog, highPrecision.templateId), config).aimLength) < 1e-12);
});
test('视图随场景销毁后不再重复 destroy', () => {
  const screen = Object.create(PrototypeView.prototype); let calls = 0;
  screen.root = { valid: true, destroying: false, destroy() { calls++; this.destroying = true; } };
  screen.dispose(); screen.dispose(); assert.equal(calls, 1);
  screen.root.valid = false; screen.dispose(); assert.equal(calls, 1);
});
test('圆形头像节点按实例缓存，无头像球员改用姓名徽章', () => {
  class TestNode {
    constructor(name) { this.name = name; this.children = []; this.components = []; this.layer = 1; this.destroyed = false; }
    addChild(node) { this.children.push(node); }
    addComponent(ComponentType) { const item = new ComponentType(); item.node = this; this.components.push(item); return item; }
    getComponent(ComponentType) { return this.components.find(item => item instanceof ComponentType); }
    setPosition(x, y) { this.position = { x, y }; }
    destroy() { this.destroyed = true; }
  }
  cc.Node = TestNode;
  cc.UITransform = class { setContentSize(width, height) { this.size = { width, height }; } };
  cc.Mask = class { static Type = { GRAPHICS_ELLIPSE: 1 }; };
  cc.Sprite = class { static SizeMode = { CUSTOM: 2 }; };
  cc.Graphics = class { circle() {} fill() {} stroke() {} roundRect() {} };
  cc.Label = class { static HorizontalAlign = { CENTER: 1 }; static VerticalAlign = { CENTER: 1 }; };
  const screen = Object.create(PrototypeView.prototype);
  screen.config = config; screen.catalog = catalog;
  screen.portraitFrames = new Map(catalog.players.filter(player => player.portraitPath)
    .map(player => [player.id, { id: player.id }]));
  screen.portraitNodes = new Map(); screen.portraitLayer = new TestNode('Portraits');
  const state = createStandardMatchState('portraits', config, 9, catalog);
  screen.setPlayers(state);
  assert.equal(screen.portraitNodes.size, 10);
  assert.equal(screen.portraitLayer.children.length, 10);
  const first = screen.portraitNodes.get('blue-1').node;
  screen.setPlayers(state);
  assert.equal(screen.portraitLayer.children.length, 10);
  const changed = { ...state, players: state.players.map((player, index) =>
    index === 0 ? { ...player, templateId: 'neymar' } : player) };
  screen.setPlayers(changed);
  assert.equal(first.destroyed, true);
  assert.equal(screen.portraitNodes.get('blue-1').templateId, 'neymar');
  const fallback = screen.portraitNodes.get('blue-1').node;
  assert.ok(fallback.children.some(child => child.components.some(component => component.string === '内马尔')));
  assert.equal(screen.portraitLayer.children.length, 11);

  const lineup = Object.create(LineupView.prototype); lineup.catalog = catalog; lineup.portraits = screen.portraitFrames;
  const lineupCard = lineup.playerCard(new TestNode('Lineup'), 'neymar', 112, 120, true);
  assert.ok(lineupCard.children.some(child => child.name === 'Avatar'
    && child.children.some(text => text.components.some(component => component.string === '内马尔'))));
  const warehouse = Object.create(PlayerWarehouseView.prototype);
  warehouse.catalog = catalog; warehouse.portraits = screen.portraitFrames;
  const warehouseAvatar = warehouse.avatar(new TestNode('Warehouse'), 'neymar', 84, 0, 0);
  assert.ok(warehouseAvatar.children.some(text => text.components.some(component => component.string === '内马尔')));
});
test('四角弹簧碰撞体使用满弹性、零摩擦且保持静态', () => {
  class PhysicsNode {
    constructor(name) { this.name = name; this.children = []; this.components = []; this.active = true; }
    addChild(node) { this.children.push(node); }
    addComponent(Type) { const component = new Type(); component.node = this; this.components.push(component); return component; }
    setPosition(x, y) { this.position = { x, y }; }
  }
  cc.Node = PhysicsNode;
  cc.RigidBody2D = class {};
  cc.CircleCollider2D = class {};
  cc.ERigidBody2DType = { Static: 'static' };
  cc.PHYSICS_2D_PTM_RATIO = 32;
  const physics = Object.create(CocosPhysics.prototype);
  physics.root = new PhysicsNode('root'); physics.config = config;
  physics.cornerBumper(config.fieldWidth / 2, config.fieldHeight / 2, config.cornerBumperRadius);
  const node = physics.root.children[0];
  const body = node.components.find(item => item instanceof cc.RigidBody2D);
  const collider = node.components.find(item => item instanceof cc.CircleCollider2D);
  assert.equal(node.name, 'CornerSpring'); assert.equal(body.type, 'static'); assert.equal(body.group, 1);
  assert.equal(collider.radius, config.cornerBumperRadius * 32);
  assert.equal(collider.restitution, 1); assert.equal(collider.friction, 0);
});
test('物理发射读取当前球员专属冲量', () => {
  const physics = Object.create(CocosPhysics.prototype);
  physics.config = config;
  physics.impulses = new Map([['blue-1', playerGameplayValues(getPlayerTemplate(catalog, 'messi'), config).maxImpulse],
    ['blue-2', playerGameplayValues(getPlayerTemplate(catalog, 'cristiano-ronaldo'), config).maxImpulse]]);
  const calls = [];
  physics.bodies = new Map([...physics.impulses.keys()].map(id => [id, {
    applyLinearImpulseToCenter(vector) { calls.push({ id, x: vector.x, y: vector.y }); },
    linearVelocity: { length: () => 0 },
  }]));
  cc.Vec2 = class { constructor(x, y) { this.x = x; this.y = y; } };
  physics.launch({ playerId: 'blue-1', power: 1, direction: { x: 1, y: 0 } });
  physics.launch({ playerId: 'blue-2', power: 1, direction: { x: 1, y: 0 } });
  assert.ok(calls[1].x > calls[0].x);
  assert.equal(calls[0].y, 0);
});
