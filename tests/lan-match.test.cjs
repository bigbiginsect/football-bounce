const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LanHost } = require('../.test-output/application/LanHost.js');
const { LanClient } = require('../.test-output/application/LanClient.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { LineupEditor } = require('../.test-output/application/LineupEditor.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } = require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog, createPlayerConditions } = require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
const { lanSettings, lanSignature, parseClientMessage, validSnapshot } = require('../.test-output/core/LanProtocol.js');
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
const config = freezeConfig(prototypeConfig);
const selection = { formationId: '2-1-2', templateIds: defaultLineups().blue.map(p => p.templateId) };

function pair() {
    const queue = [], sent = { host: [], client: [] };
    let closed = false;
    const a = { send: data => { if (closed) throw Error('closed'); sent.host.push(data); queue.push(() => b.onMessage?.(data)); },
        close: () => { if (!closed) { closed = true; queue.push(() => b.onClose?.()); } } };
    const b = { send: data => { if (closed) throw Error('closed'); sent.client.push(data); queue.push(() => a.onMessage?.(data)); },
        close: () => { if (!closed) { closed = true; queue.push(() => a.onClose?.()); } } };
    return { a, b, sent, pump: () => { let count = 0; while (queue.length) { assert.ok(++count < 200); queue.shift()(); } } };
}
class Physics {
    launches = 0; goal = null;
    restore(s) { this.frame = structuredClone({ players: s.players, ball: s.ball }); }
    launch() { this.launches++; }
    step() {
        if (this.goal) this.frame.ball.position = { x: 0, y: (config.fieldHeight / 2 + config.ballRadius + 0.01) * (this.goal === 'top' ? 1 : -1) };
    }
    sample() { return structuredClone({ ...this.frame, goal: this.goal }); }
    stop() {}
}
function setup(patch = {}) {
    const cfg = freezeConfig({ ...config, ...patch });
    const p = pair();
    const events = { hostRooms: [], clientRooms: [], snapshots: [], rejected: [], hostEnd: [], clientEnd: [] };
    let match, physics;
    const conditions = createPlayerConditions(catalog, 44);
    const host = new LanHost('room', cfg, catalog, conditions, {
        createMatch: (lineups, id, c) => {
            physics = new Physics();
            match = new LocalMatch(createStandardMatchState(id, cfg, 5, catalog, lineups, c), physics, cfg);
            return match;
        },
        roomChanged: r => events.hostRooms.push(r), ended: r => events.hostEnd.push(r), ballAngle: () => 42,
    });
    host.attach(p.a);
    const client = new LanClient(p.b, cfg, catalog, {
        welcomed: c => { events.conditions = c; }, roomChanged: r => events.clientRooms.push(r),
        snapshot: (s, status, angle) => events.snapshots.push({ state: s, status, angle }),
        rejected: r => events.rejected.push(r), ended: r => events.clientEnd.push(r),
    });
    client.start();
    p.pump();
    const ready = () => { host.readyBlue(selection); client.ready(selection); p.pump(); };
    const tick = dt => { client.tick(dt); p.pump(); host.tick(dt); p.pump(); };
    const command = (side, id = 'shot') => {
        const s = match.getSnapshot(); return { type: 'Launch', commandId: id, matchId: s.matchId,
            turnNumber: s.turnNumber, operatorId: side, playerId: s.players.find(p => p.ownerId === side).instanceId,
            direction: { x: 0, y: 1 }, power: 0.5 };
    };
    return { host, client, ...p, events, ready, tick, command, get match() { return match; }, get physics() { return physics; } };
}

test('附近握手绑定红队，共享房主心理状态，双方准备才创建完整比赛', () => {
    const s = setup();
    assert.equal(s.host.getRoom().connected, true);
    assert.deepEqual(s.events.conditions, s.host.conditions);
    s.host.readyBlue(selection); s.pump(); assert.equal(s.match, undefined);
    s.client.ready({ ...selection, formationId: '1-2-2' }); s.pump();
    const last = s.events.snapshots.at(-1);
    assert.equal(last.state.players.length, 10); assert.equal(last.angle, 42);
    assert.deepEqual(last.state, s.match.getSnapshot());
    assert.equal(last.state.players.find(p => p.ownerId === 'red').position.y, 3.95);
    assert.equal(s.client.getRoom().stage, 'Playing');
});
test('连接身份不可伪造，不能操作房主球员或传入比分', () => {
    const s = setup(); s.ready();
    const before = s.match.getSnapshot();
    s.b.send(JSON.stringify({ type: 'Launch', command: { ...s.command('blue'), score: { red: 99 } } })); s.pump();
    assert.equal(s.events.rejected.at(-1), 'IdentityMismatch');
    assert.deepEqual(s.match.getSnapshot(), before);
    assert.equal(s.physics.launches, 0);
    s.b.send(JSON.stringify({ type: 'Snapshot', state: { score: { red: 99 } } })); s.pump();
    assert.deepEqual(s.match.getSnapshot().score, { blue: 0, red: 0 });
});
test('仅行动方发射；客人不推进比赛，重复和过期命令只执行一次', () => {
    const s = setup(); s.ready();
    if (s.match.getSnapshot().activeOperatorId === 'blue') { s.host.executeBlue(s.command('blue', 'blue-start')); s.pump(); for (let i = 0; i < 25; i++) s.tick(1 / 60); }
    const cmd = s.command('red');
    const before = s.events.snapshots.at(-1).state;
    s.client.tick(0.1); s.pump(); assert.deepEqual(s.events.snapshots.at(-1).state, before);
    assert.equal(s.client.launch(cmd), true);
    assert.equal(s.client.launch({ ...cmd, commandId: 'duplicate-touch' }), false);
    s.pump(); assert.equal(s.match.getSnapshot().phase, 'Simulating');
    s.b.send(JSON.stringify({ type: 'Launch', command: cmd })); s.pump();
    assert.equal(s.events.rejected.at(-1), 'DuplicateCommand');
    for (let i = 0; i < 25; i++) s.tick(1 / 60);
    s.b.send(JSON.stringify({ type: 'Launch', command: { ...cmd, commandId: 'stale' } })); s.pump();
    assert.equal(s.events.rejected.at(-1), 'WrongTurn');
    const received = s.events.snapshots.at(-1).state, current = s.match.getSnapshot();
    assert.deepEqual(received.players, current.players);
    assert.equal(received.turnNumber, current.turnNumber);
    assert.ok(current.clock.elapsedMs - received.clock.elapsedMs <= 50 + 1e-6);
});
test('快照含运动、进球复位和结局；赛后双方重新准备，新局拒绝旧命令', () => {
    const s = setup({ matchSeconds: 10 }); s.ready();
    let side = s.match.getSnapshot().activeOperatorId;
    const send = (side, id) => { const cmd = s.command(side, id); side === 'blue' ? s.host.executeBlue(cmd) : s.client.launch(cmd); s.pump(); return cmd; };
    send(side, 'kickoff'); for (let i = 0; i < 25; i++) s.tick(1 / 60);
    side = s.match.getSnapshot().activeOperatorId;
    const old = send(side, 'goal'); s.physics.goal = 'top'; s.tick(1 / 60); s.physics.goal = null;
    assert.equal(s.match.getSnapshot().score.blue, 1);
    assert.equal(s.events.snapshots.at(-1).status.reason, 'goal');
    assert.deepEqual(s.events.snapshots.at(-1).state.ball.position, { x: 0, y: 0 });
    for (let i = 0; i < 10; i++) s.tick(1);
    assert.equal(s.client.getRoom().stage, 'Finished');
    assert.equal(s.events.snapshots.at(-1).state.result.winnerId, 'blue');
    s.client.rematch(); s.pump(); assert.equal(s.host.getRoom().round, 2);
    s.host.readyBlue(selection); s.pump(); assert.equal(s.host.getRoom().stage, 'Selecting');
    s.client.ready(selection); s.pump();
    assert.equal(s.match.getSnapshot().matchId, 'room-2'); assert.equal(s.match.getSnapshot().score.blue, 0);
    s.b.send(JSON.stringify({ type: 'Launch', command: { ...old, operatorId: 'red' } })); s.pump();
    assert.equal(s.events.rejected.at(-1), 'WrongMatch');
});
test('旧快照与旧轮次不覆盖最新状态，非法快照导致明确中止', () => {
    const s = setup(); s.ready(); const packet = JSON.parse(s.sent.host.filter(x => JSON.parse(x).type === 'Snapshot').at(-1));
    s.tick(0.1); const revision = s.events.snapshots.at(-1).state.revision;
    s.a.send(JSON.stringify(packet)); s.pump(); assert.equal(s.events.snapshots.at(-1).state.revision, revision);
    packet.round = 0; s.a.send(JSON.stringify(packet)); s.pump(); assert.equal(s.events.clientEnd.length, 0);
    packet.round = 1; packet.state.players[0].position.x = 999;
    s.a.send(JSON.stringify(packet)); s.pump();
    assert.match(s.events.clientEnd.at(-1), /快照/); assert.equal(s.events.hostEnd.length, 1);
});
test('版本不一致、第二客人、握手超时不会占据合法席位', () => {
    const s = setup(); const other = pair(); s.host.attach(other.a); other.pump();
    assert.match(JSON.parse(other.sent.host[0]).reason, /已满/);
    assert.equal(s.host.getRoom().connected, true);
    const configChanged = freezeConfig({ ...config, maxSpeed: config.maxSpeed - 1 });
    assert.notEqual(lanSignature(config, catalog), lanSignature(configChanged, catalog));
    const host = new LanHost('empty', config, catalog, createPlayerConditions(catalog, 1), {
        createMatch: () => { throw Error('must not start'); }, roomChanged() {}, ended() {}, ballAngle: () => 0,
    });
    const bad = pair(); host.attach(bad.a); bad.b.send(JSON.stringify({ type: 'Hello', signature: 'old' })); bad.pump();
    assert.match(JSON.parse(bad.sent.host[0]).reason, /不一致/);
    const pending = pair(); host.attach(pending.a); host.tick(9); pending.pump();
    const valid = pair(); host.attach(valid.a); valid.b.send(JSON.stringify({ type: 'Hello', signature: lanSignature(config, catalog) })); valid.pump();
    assert.equal(host.getRoom().connected, true);
});
test('心跳中断、主动离开均中止房间，迟到消息不能恢复或改比分', () => {
    const s = setup(); s.ready(); const before = s.match.getSnapshot();
    s.host.tick(9); s.pump(); assert.match(s.events.clientEnd.at(-1), /超时/);
    s.host.tick(3); assert.deepEqual(s.match.getSnapshot(), before);
    const t = setup(); t.ready(); t.client.close(); t.pump();
    assert.equal(t.events.hostEnd.length, 1); assert.equal(t.events.clientEnd.length, 1);
});
test('未握手客户端超时退出；持续心跳也不能隐藏发射回执超时', () => {
    const p = pair(), reasons = [];
    const c = new LanClient(p.b, config, catalog, { welcomed() {}, roomChanged() {}, snapshot() {}, rejected() {}, ended: r => reasons.push(r) });
    c.start();
    c.tick(9); assert.match(reasons[0], /超时/);
    const s = setup(); s.ready();
    s.client.launch(s.command('red'));
    // 模拟服务器只回心跳、不处理发射。
    s.a.onMessage = data => { if (JSON.parse(data).type === 'Ping') s.a.send('{"type":"Pong"}'); };
    s.pump(); for (let i = 0; i < 9; i++) { s.client.tick(1); s.pump(); }
    assert.match(s.events.clientEnd.at(-1), /超时/);
});
test('选人只确认当前席位，不能切回另一队；无效阵容与超大消息被拒绝', () => {
    const editor = new LineupEditor(catalog, config, undefined, 'red');
    assert.equal(editor.execute({ type: 'BackToBlue' }), false);
    assert.equal(editor.getSnapshot().side, 'red');
    editor.execute({ type: 'ConfirmSide' }); assert.equal(editor.getSnapshot().ready, true);
    for (const v of [null, '{', 'x'.repeat(lanSettings.maxMessageLength + 1),
        JSON.stringify({ type: 'Ready', round: 1, selection: { ...selection, templateIds: Array(5).fill('messi') } })]) {
        assert.equal(parseClientMessage(v, catalog), null);
    }
});
test('快照结构校验覆盖时钟、技能、心理、队内重复和非有限位置', () => {
    const valid = createStandardMatchState('test', config, 1, catalog, undefined, createPlayerConditions(catalog, 2));
    assert.equal(validSnapshot(valid, config, catalog), true);
    const patches = [s => s.clock.remainingMs = -1, s => s.ball.velocity.x = Infinity,
        s => s.players[0].position.x = NaN, s => s.players[0].instanceId = s.players[1].instanceId,
        s => s.conditions.values.messi = 'bogus', s => s.skills.forcedPlayerId = 'unknown',
        s => s.kickoff.players = null, s => s.random.state = -1, s => s.score.blue = 0.2,
        s => s.players[0].templateId = s.players[1].templateId];
    for (const patch of patches) { const s = structuredClone(valid); patch(s); assert.equal(validSnapshot(s, config, catalog), false); }
});
test('物理发射异常直接换手时，客端仍释放待回执状态而不误判连接超时', () => {
    const s = setup(); s.ready(); assert.equal(s.match.getSnapshot().activeOperatorId, 'red');
    s.physics.launch = () => { throw Error('physics unavailable'); };
    assert.equal(s.client.launch(s.command('red')), true); s.pump();
    assert.equal(s.events.snapshots.at(-1).state.phase, 'Aiming');
    assert.equal(s.events.snapshots.at(-1).state.turnNumber, 2);
    for (let i = 0; i < 9; i++) s.tick(1);
    assert.equal(s.events.clientEnd.length, 0);
});
