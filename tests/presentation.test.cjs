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
const { LocalMatch } = load('assets/scripts/application/LocalMatch.ts');
const { LaunchGesture } = load('assets/scripts/core/LaunchGesture.ts');
const { prototypeConfig, freezeConfig, createPrototypeState } = load('assets/scripts/core/PrototypeConfig.ts');
const config = freezeConfig(prototypeConfig);
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
  screen.bodies = { clear() {}, circle() {}, fill() {}, stroke() {} };
  screen.status = {}; screen.info = {};
  const circles = [];
  screen.powerCircle = { clear() { circles.length = 0; }, circle(x, y, radius) { circles.push({ x, y, radius }); }, fill() {} };
  const lines = [];
  screen.aim = { clear() { lines.length = 0; }, moveTo(x, y) { lines.push([x, y]); },
    lineTo(x, y) { lines.push([x, y]); }, stroke() {} };
  const state = createPrototypeState('view', config, 'normal');
  return { screen, state, lines, circles };
}
test('白色虚线有间隔，精度总长不随力度变化，方向正确', () => {
  const { screen, state, lines } = viewFixture();
  for (const power of [0.01, 0.5, 1]) for (const direction of [{ x: 0, y: 1 }, { x: -1, y: 0 }]) {
    screen.render(state, { playerId: 'a1', aim: { direction, power } }, '', '');
    const start = lines[0], end = lines.at(-2); // 最后三个点是箭头，第二个为精度线端点。
    assert.equal(Math.hypot(end[0] - start[0], end[1] - start[1]), config.aimLength * 80);
    assert.equal(end[0] - start[0], direction.x * config.aimLength * 80);
    assert.equal(end[1] - start[1], direction.y * config.aimLength * 80);
    assert.equal(screen.aim.strokeColor, Color.WHITE);
    assert.ok(Math.abs(Math.hypot(lines[1][0]-start[0], lines[1][1]-start[1]) - config.aimDashLength*80) < 1e-8);
    assert.ok(Math.abs(Math.hypot(lines[2][0]-lines[1][0], lines[2][1]-lines[1][1]) - config.aimDashGap*80) < 1e-8);
  }
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
  assert.equal(radii[2], config.powerCircleMaxRadius * 80); assert.equal(radii[3], radii[2]);
  screen.render(state, { playerId: 'a1', aim: null }, '', '');
  assert.equal(circles[0].radius, config.playerRadius*80); assert.equal(lines.length, 0);
  screen.render(state, null, '', ''); assert.equal(circles.length, 0); assert.equal(lines.length, 0);
});
test('视图随场景销毁后不再重复 destroy', () => {
  const screen = Object.create(PrototypeView.prototype); let calls = 0;
  screen.root = { valid: true, destroying: false, destroy() { calls++; this.destroying = true; } };
  screen.dispose(); screen.dispose(); assert.equal(calls, 1);
  screen.root.valid = false; screen.dispose(); assert.equal(calls, 1);
});
