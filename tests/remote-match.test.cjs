const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RemoteGateway } = require('../.test-output/application/RemoteGateway.js');
const { LanClient } = require('../.test-output/application/LanClient.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } = require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog, createPlayerConditions } = require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
const { lanSignature } = require('../.test-output/core/LanProtocol.js');
const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
const config = freezeConfig(prototypeConfig), accessKey = 'test-key-12345678';
const selection = { formationId: '2-1-2', templateIds: defaultLineups().blue.map(p => p.templateId) };
function fixture(patch = {}, limits = {}) {
    const cfg = freezeConfig({ ...config, ...patch });
    const queue = [], clients = [], matches = new Map(), ended = [];
    let sequence = 0;
    const pump = () => { let n = 0; while (queue.length) { assert.ok(++n < 1000); queue.shift()(); } };
    const gateway = new RemoteGateway({ config: cfg, catalog, authenticate: key => key === accessKey,
        roomCode: () => (++sequence).toString(16).toUpperCase().padStart(6, '0'), roomId: () => `remote-${sequence}`,
        conditions: () => createPlayerConditions(catalog, sequence), ...limits,
        hooks: code => ({ createMatch(lineups, id, conditions) {
            const physics = { restore(s) { this.frame = structuredClone({ players: s.players, ball: s.ball, goal: null }); },
                launch() {}, step() {}, sample() { return this.frame; }, stop() {} };
            const match = new LocalMatch(createStandardMatchState(id, cfg, 5, catalog, lineups, conditions), physics, cfg);
            matches.set(code, match); return match;
        }, ballAngle: () => 3, roomChanged() {}, ended: reason => ended.push([code, reason]) }),
    });
    const connect = (action = 'Create', roomCode = '', key = accessKey, configOverride = cfg) => {
        let closed = false;
        const server = { send: data => { if (closed) throw Error('closed'); queue.push(() => clientPeer.onMessage?.(data)); },
            close: () => { if (closed) return; closed = true; queue.push(() => clientPeer.onClose?.()); } };
        const clientPeer = { send: data => { if (closed) throw Error('closed'); queue.push(() => server.onMessage?.(data)); },
            close: () => { if (closed) return; closed = true; queue.push(() => server.onClose?.()); } };
        const events = { rooms: [], snapshots: [], rejections: [], ended: [] };
        gateway.attach(server);
        const client = new LanClient(clientPeer, configOverride, catalog, {
            welcomed: c => events.conditions = c, roomChanged: r => events.rooms.push(r),
            snapshot: state => events.snapshots.push(state), rejected: r => events.rejections.push(r), ended: r => events.ended.push(r),
        }, { action, roomCode, accessKey: key });
        clients.push(client); client.start(); pump();
        return { client, peer: clientPeer, events, get code() { return client.getRoom()?.code; } };
    };
    const tick = dt => { for (const c of clients) c.tick(dt); pump(); gateway.tick(dt); pump(); };
    const command = (state, side, commandId) => ({ type: 'Launch', matchId: state.matchId, turnNumber: state.turnNumber,
        operatorId: side, commandId, playerId: state.players.find(p => p.ownerId === side).instanceId,
        direction: { x: 0, y: 1 }, power: 0.3 });
    return { gateway, connect, pump, tick, matches, ended, command };
}
test('远程电脑分配两条真实席位，统一心理和各自阵容，双方准备后广播同一快照', () => {
    const f = fixture(); const blue = f.connect();
    assert.equal(blue.client.side, 'blue'); assert.equal(blue.client.getRoom().connected, false);
    blue.client.ready(selection); f.pump(); assert.equal(f.matches.size, 0);
    const red = f.connect('Join', blue.code); assert.equal(red.client.side, 'red');
    assert.equal(blue.client.getRoom().connected, true); assert.deepEqual(blue.events.conditions, red.events.conditions);
    red.client.ready({ ...selection, formationId: '1-2-2' }); f.pump();
    assert.deepEqual(blue.events.snapshots.at(-1), red.events.snapshots.at(-1));
    assert.equal(blue.events.snapshots.at(-1).players.find(p => p.ownerId === 'red').position.y, 3.95);
    assert.deepEqual(f.gateway.getStats(), { rooms: 1, connections: 2 }); f.gateway.close(); f.pump();
    assert.deepEqual(f.gateway.getStats(), { rooms: 0, connections: 0 }); assert.equal(f.ended.length, 1);
});
test('蓝红网络连接均拒绝冒充另一方、重复、过期及跨局发射', () => {
    const f = fixture({ matchSeconds: 10 }); const blue = f.connect(), red = f.connect('Join', blue.code);
    blue.client.ready(selection); red.client.ready(selection); f.pump();
    let state = f.matches.get(blue.code).getSnapshot(); const original = state;
    blue.peer.send(JSON.stringify({ type: 'Launch', command: f.command(state, 'red', 'spoof-red') }));
    red.peer.send(JSON.stringify({ type: 'Launch', command: f.command(state, 'blue', 'spoof-blue') })); f.pump();
    assert.equal(blue.events.rejections.at(-1), 'IdentityMismatch'); assert.equal(red.events.rejections.at(-1), 'IdentityMismatch');
    assert.deepEqual(f.matches.get(blue.code).getSnapshot(), original);
    const client = state.activeOperatorId === 'blue' ? blue : red;
    const command = f.command(state, state.activeOperatorId, 'valid-shot'); client.client.launch(command); f.pump();
    client.peer.send(JSON.stringify({ type: 'Launch', command })); f.pump(); assert.equal(client.events.rejections.at(-1), 'DuplicateCommand');
    for (let i = 0; i < 25; i++) f.tick(1 / 60);
    client.peer.send(JSON.stringify({ type: 'Launch', command: { ...command, commandId: 'old-turn' } })); f.pump();
    assert.equal(client.events.rejections.at(-1), 'WrongTurn');
    for (let i = 0; i < 10; i++) f.tick(1);
    assert.equal(blue.events.snapshots.at(-1).phase, 'Finished');
    blue.client.rematch(); f.pump(); blue.client.ready(selection); f.pump();
    assert.equal(blue.client.getRoom().stage, 'Selecting');
    red.client.ready(selection); f.pump(); state = f.matches.get(blue.code).getSnapshot();
    assert.notEqual(state.matchId, command.matchId);
    client.peer.send(JSON.stringify({ type: 'Launch', command })); f.pump();
    assert.equal(client.events.rejections.at(-1), 'WrongMatch'); f.gateway.close();
});
test('远程口令、版本、房间码、满房及服务容量明确拒绝且不占用席位', () => {
    const f = fixture({}, { maxRooms: 1, maxConnections: 4 });
    assert.match(f.connect('Create', '', 'wrong-key-12345').events.ended[0], /口令错误/);
    assert.match(f.connect('Create', '', accessKey, freezeConfig({ ...config, maxSpeed: 16 })).events.ended[0], /不一致/);
    assert.match(f.connect('Join', 'ABCDEF').events.ended[0], /不存在/);
    const blue = f.connect(), red = f.connect('Join', blue.code);
    assert.match(f.connect('Join', blue.code).events.ended[0], /已满/);
    assert.match(f.connect().events.ended[0], /已满/);
    assert.deepEqual(f.gateway.getStats(), { rooms: 1, connections: 2 });
    red.client.close(); f.pump(); assert.match(blue.events.ended[0], /断开|退出/);
    assert.deepEqual(f.gateway.getStats(), { rooms: 0, connections: 0 });
});
test('多房间断线与异常消息隔离，一间关闭不影响另一间继续比赛', () => {
    const f = fixture(); const a = f.connect(), b = f.connect('Join', a.code), c = f.connect(), d = f.connect('Join', c.code);
    for (const p of [a, b, c, d]) p.client.ready(selection); f.pump();
    assert.notEqual(a.events.snapshots[0].matchId, c.events.snapshots[0].matchId);
    a.client.close(); f.pump(); f.tick(1);
    assert.equal(b.events.ended.length, 1); assert.equal(c.events.ended.length, 0); assert.equal(d.events.ended.length, 0);
    assert.deepEqual(f.gateway.getStats(), { rooms: 1, connections: 2 });
    c.peer.send('{"type":"Snapshot","score":{"blue":99}}'); f.pump();
    assert.equal(f.matches.get(c.code).getSnapshot().score.blue, 0); f.gateway.close();
});
test('蓝方心跳丢失、红方丢失、未握手超时及消息洪泛均释放房间/连接', () => {
    for (const side of ['blue', 'red']) {
        const f = fixture(); const blue = f.connect(), red = f.connect('Join', blue.code);
        const alive = side === 'blue' ? red : blue;
        for (let i = 0; i < 9; i++) { alive.client.tick(1); f.pump(); f.gateway.tick(1); f.pump(); }
        assert.deepEqual(f.gateway.getStats(), { rooms: 0, connections: 0 });
    }
    const f = fixture(); let closed = 0;
    f.gateway.attach({ send() {}, close() { closed++; } }); f.gateway.tick(9);
    assert.equal(closed, 1); assert.equal(f.gateway.getStats().connections, 0);
    const blue = f.connect(); for (let i = 0; i < 45; i++) blue.peer.send('{"type":"Ping"}'); f.pump();
    assert.match(blue.events.ended[0], /频繁/); assert.equal(f.gateway.getStats().rooms, 0);
});
test('远程首包不是普通附近握手，空加入码不会被当成创建请求', () => {
    const f = fixture(); assert.match(f.connect('Join', '').events.ended[0], /无效/);
    let reason, closed = false;
    const peer = { send: s => reason = JSON.parse(s).reason, close: () => closed = true };
    f.gateway.attach(peer); peer.onMessage(JSON.stringify({ type: 'Hello', signature: lanSignature(config, catalog) }));
    assert.equal(closed, true); assert.match(reason, /无效/);
});
