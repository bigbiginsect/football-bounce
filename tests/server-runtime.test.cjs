const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const { createComputerServer, serverConfig, socketPeer, loadDependencies } = require('../server/main.cjs');
const { LanClient } = require('../.test-output/application/LanClient.js');
const { prototypeConfig, freezeConfig } = require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog } = require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
let box2d;
try { box2d = require(process.env.CREATOR_BOX2D_MODULE_PATH || '../server/node_modules/@cocos/box2d'); } catch {}
const accessKey = 'runtime-test-12345678';
test('电脑启动配置校验、默认随机口令与WebSocket发送/非法消息关闭', () => {
    assert.equal(serverConfig({}).port, 8766);
    assert.notEqual(serverConfig({}).accessKey, serverConfig({}).accessKey);
    for (const env of [{ FOOTBALL_PORT: 'bad' }, { FOOTBALL_ACCESS_KEY: 'short' }, { FOOTBALL_MAX_ROOMS: '999' }, { FOOTBALL_WS_PATH: '/healthz' }])
        assert.throws(() => serverConfig(env));
    const socket = new EventEmitter(); socket.readyState = 1; socket.bufferedAmount = 0;
    socket.send = (data, cb) => { socket.sent = data; cb?.(); };
    socket.close = () => { socket.readyState = 3; }; socket.terminate = () => { socket.readyState = 3; };
    const peer = socketPeer(socket, 100); let received, closed = 0;
    peer.onMessage = data => received = data; peer.onClose = () => closed++;
    socket.emit('message', Buffer.from('hello'), false); assert.equal(received, 'hello');
    peer.send('world'); assert.equal(socket.sent, 'world');
    socket.bufferedAmount = 401; assert.throws(() => peer.send('slow'), /拥塞/);
    socket.emit('message', Buffer.from([0]), true); assert.equal(closed, 1); assert.equal(socket.readyState, 3);
});
test('真实服务组合层用Box2D贯通两远程客户端、连续运动与关闭释放（传输事件替身）', async t => {
    if (!box2d) { t.skip('需要@cocos/box2d或CREATOR_BOX2D_MODULE_PATH'); return; }
    let wss;
    class Wss extends EventEmitter {
        clients = new Set(); constructor(options) { super(); this.options = options; wss = this; }
        close(cb) { cb?.(); }
    }
    const server = createComputerServer({ WebSocketServer: Wss, box2d,
        config: serverConfig({ FOOTBALL_ACCESS_KEY: accessKey }), runtime: path.resolve(__dirname, '../.test-output'),
        logger: { log() {}, error: reason => assert.fail(reason) } });
    t.after(() => server.close());
    assert.equal(wss.options.maxPayload, 65536); assert.equal(wss.options.perMessageDeflate, false);
    const queue = [], clients = [], pump = () => { let n = 0; while (queue.length) { assert.ok(++n < 1000); queue.shift()(); } };
    const config = freezeConfig(prototypeConfig), catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
    const selection = { formationId: '2-1-2', templateIds: defaultLineups().blue.map(p => p.templateId) };
    const connect = (action, roomCode = '') => {
        const socket = new EventEmitter(); socket.readyState = 1; socket.bufferedAmount = 0;
        socket.send = (data, cb) => { queue.push(() => peer.onMessage?.(data)); cb?.(); };
        socket.close = () => { if (socket.readyState === 3) return; socket.readyState = 3;
            queue.push(() => { socket.emit('close'); peer.onClose?.(); }); };
        socket.terminate = socket.close; wss.clients.add(socket); socket.on('close', () => wss.clients.delete(socket));
        const peer = { send: data => queue.push(() => socket.emit('message', Buffer.from(data), false)), close: () => socket.close() };
        wss.emit('connection', socket);
        const events = { snapshots: [], ended: [] };
        const client = new LanClient(peer, config, catalog, { welcomed() {}, roomChanged() {},
            snapshot: s => events.snapshots.push(s), rejected: reason => assert.fail(reason), ended: r => events.ended.push(r),
        }, { action, roomCode, accessKey });
        clients.push(client); client.start(); pump(); return { client, events };
    };
    const blue = connect('Create'), red = connect('Join', blue.client.getRoom().code);
    blue.client.ready(selection); red.client.ready(selection); pump();
    let state = blue.events.snapshots.at(-1); assert.deepEqual(state, red.events.snapshots.at(-1));
    const active = state.activeOperatorId === 'blue' ? blue : red;
    const player = state.players.find(p => p.ownerId === state.activeOperatorId);
    active.client.launch({ type: 'Launch', commandId: 'runtime-shot', matchId: state.matchId, turnNumber: state.turnNumber,
        operatorId: state.activeOperatorId, playerId: player.instanceId, power: 0.4, direction: { x: 0, y: state.activeOperatorId === 'blue' ? 1 : -1 } }); pump();
    assert.equal(blue.events.snapshots.at(-1).phase, 'Simulating');
    for (let i = 0; i < 950 && blue.events.snapshots.at(-1).phase === 'Simulating'; i++) {
        for (const client of clients) client.tick(1 / 60); pump(); server.gateway.tick(1 / 60); pump();
    }
    assert.equal(blue.events.snapshots.at(-1).phase, 'Aiming');
    assert.deepEqual(blue.events.snapshots.at(-1), red.events.snapshots.at(-1));
    assert.ok(blue.events.snapshots.some(s => Math.abs(s.players.find(p => p.instanceId === player.instanceId).position.y - player.position.y) > 0.1));
    await server.close(); pump(); assert.deepEqual(server.gateway.getStats(), { rooms: 0, connections: 0 });
    assert.equal(blue.events.ended.length, 1); assert.equal(red.events.ended.length, 1);
});
test('真实电脑服务HTTP/WebSocket监听与双客户端握手', async t => {
    let dependencies;
    try { dependencies = loadDependencies(); } catch { t.skip('server的ws/Box2D依赖尚未安装，须联网安装后复验'); return; }
    const allowed = await new Promise((resolve, reject) => {
        const probe = net.createServer(socket => socket.end());
        probe.on('error', reject); probe.listen(0, '127.0.0.1', () => {
            let canConnect = true; const socket = net.connect(probe.address().port, '127.0.0.1');
            socket.on('error', error => { if (['EACCES', 'EPERM'].includes(error.code)) canConnect = false; else reject(error); });
            socket.on('close', () => probe.close(() => resolve(canConnect)));
        });
    });
    if (!allowed) { t.skip('沙箱拒绝TCP回环连接'); return; }
    const server = createComputerServer({ ...dependencies, config: serverConfig({ FOOTBALL_HOST: '127.0.0.1', FOOTBALL_PORT: '0', FOOTBALL_ACCESS_KEY: accessKey }),
        runtime: path.resolve(__dirname, '../.test-output'), logger: { log() {}, error() {} } });
    t.after(() => server.close()); const address = await server.listen();
    const health = await fetch(`http://127.0.0.1:${address.port}/healthz`); assert.deepEqual(await health.json(), { ok: true });
    const config = freezeConfig(prototypeConfig), catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
    const connect = async (action, roomCode = '') => {
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}/football`);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        const peer = { send: data => socket.send(data), close: () => socket.close() };
        socket.onmessage = e => peer.onMessage?.(e.data); socket.onclose = () => peer.onClose?.();
        const client = new LanClient(peer, config, catalog, { welcomed() {}, roomChanged() {}, snapshot() {}, rejected() {}, ended() {} }, { action, roomCode, accessKey });
        client.start();
        const deadline = Date.now() + 2000;
        while (!client.getRoom()) { if (Date.now() >= deadline) throw Error('握手超时'); await new Promise(r => setTimeout(r, 10)); }
        return client;
    };
    const blue = await connect('Create'); const red = await connect('Join', blue.getRoom().code);
    assert.equal(blue.side, 'blue'); assert.equal(red.side, 'red'); blue.close(); red.close();
});
