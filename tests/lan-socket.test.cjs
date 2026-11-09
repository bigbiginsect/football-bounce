const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { LoopbackServer } = require('./helpers/loopback-websocket.cjs');
const { LanHost } = require('../.test-output/application/LanHost.js');
const { LanClient } = require('../.test-output/application/LanClient.js');
const { LocalMatch } = require('../.test-output/application/LocalMatch.js');
const { prototypeConfig, freezeConfig, createStandardMatchState } = require('../.test-output/core/PrototypeConfig.js');
const { parsePlayerCatalog, createPlayerConditions } = require('../.test-output/core/PlayerCatalog.js');
const { defaultLineups } = require('../.test-output/core/Lineup.js');
const net = require('node:net');
async function loopbackAvailable() {
    const server = net.createServer(socket => socket.end());
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const socket = net.connect(server.address().port, '127.0.0.1');
            let available = true;
            socket.once('error', error => { if (error.code === 'EACCES' || error.code === 'EPERM') available = false; else reject(error); });
            socket.once('close', () => server.close(() => resolve(available)));
        });
    });
}
function adapter(globals = {}) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../assets/scripts/adapters/network/LanSocket.ts'), 'utf8'),
        { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports, require: name => require(path.resolve(__dirname, '../.test-output/adapters/network', name)),
        setTimeout, clearTimeout, WebSocket, ...globals });
    return exports;
}
const waitFor = async check => {
    const deadline = Date.now() + 3000;
    while (!check()) { if (Date.now() > deadline) throw Error('等待网络事件超时'); await new Promise(r => setTimeout(r, 10)); }
};
test('IPv4地址校验及取消连接，不支持监听的Web环境明确拒绝创建', async () => {
    const a = adapter(); assert.equal(a.canHostLan(), false);
    assert.equal(a.lanAddress(' 192.168.43.1 '), 'ws://192.168.43.1:8765');
    assert.equal(a.lanAddress('127.0.0.1:8888'), 'ws://127.0.0.1:8888');
    for (const value of ['', 'https://example.com', '999.0.0.1', '192.168.1.255', '224.0.0.1', '192.168.1.1:0', '192.168.1.1:99999'])
        assert.throws(() => a.lanAddress(value));
    await assert.rejects(new a.LanSocketServer().listen(() => {}, () => {}), /Android/);
    const connection = a.connectLan('127.0.0.1:1'); connection.cancel();
    await assert.rejects(connection.result, /取消/);
});
test('真实WebSocket回环贯通原生形状服务端、双方准备、权威快照和退出', async t => {
    if (!await loopbackAvailable()) { t.skip('当前沙箱拒绝本机TCP连接（EACCES），须在普通终端复验'); return; }
    let nativeServer;
    class NativeServer extends LoopbackServer { constructor() { super(); nativeServer = this; } }
    const a = adapter({ WebSocketServer: NativeServer }); assert.equal(a.canHostLan(), true);
    const config = freezeConfig(prototypeConfig), catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
    const selection = { formationId: '2-1-2', templateIds: defaultLineups().blue.map(p => p.templateId) };
    let match, snapshot, client, hostEnded = 0, clientEnded = 0;
    const host = new LanHost('loopback', config, catalog, createPlayerConditions(catalog, 123), {
        createMatch: (lineups, id, conditions) => {
            const physics = { restore(s) { this.frame = { players: s.players, ball: s.ball, goal: null }; },
                launch() {}, step() {}, sample() { return this.frame; }, stop() {} };
            match = new LocalMatch(createStandardMatchState(id, config, 5, catalog, lineups, conditions), physics, config); return match;
        }, roomChanged() {}, ballAngle: () => 10, ended: () => hostEnded++,
    });
    const server = new a.LanSocketServer(0);
    t.after(() => { client?.close(); host.close(); server.close(); });
    await server.listen(peer => host.attach(peer), reason => assert.fail(reason));
    const peer = await a.connectLan(`127.0.0.1:${nativeServer.port}`).result;
    client = new LanClient(peer, config, catalog, { welcomed() {}, roomChanged() {}, rejected: reason => assert.fail(reason),
        snapshot: state => snapshot = state, ended: () => clientEnded++ });
    client.start(); await waitFor(() => client.getRoom());
    host.readyBlue(selection); client.ready(selection); await waitFor(() => snapshot);
    assert.deepEqual(snapshot, match.getSnapshot());
    const state = snapshot, side = state.activeOperatorId;
    const command = { type: 'Launch', commandId: 'tcp-shot', matchId: state.matchId, turnNumber: state.turnNumber,
        operatorId: side, playerId: state.players.find(p => p.ownerId === side).instanceId, direction: { x: 0, y: 1 }, power: 0.5 };
    side === 'blue' ? host.executeBlue(command) : client.launch(command);
    await waitFor(() => snapshot.phase === 'Simulating');
    for (let i = 0; i < 20; i++) host.tick(1 / 60);
    await waitFor(() => snapshot.phase === 'Aiming');
    assert.equal(snapshot.turnNumber, 2);
    client.close(); await waitFor(() => hostEnded === 1);
    assert.equal(clientEnded, 1);
});
test('原生服务端事件转换、发送失败、关闭清理及取消监听回调', async () => {
    let native, peer, failure;
    class Server {
        constructor() { native = this; }
        listen(port, callback) { this.port = port; callback(); }
        close() { this.stopped = true; this.onclose?.(); }
    }
    const a = adapter({ WebSocketServer: Server });
    const server = new a.LanSocketServer();
    await server.listen(value => peer = value, reason => failure = reason);
    assert.equal(native.port, 8765);
    const connection = { readyState: 1, send(data, callback) { this.sent = data; callback?.(); }, close() { this.closed = true; this.onclose?.(); } };
    native.onconnection(connection);
    let received, closed = 0; peer.onMessage = data => received = data; peer.onClose = () => closed++;
    connection.onmessage('hello'); assert.equal(received, 'hello');
    peer.send('state'); assert.equal(connection.sent, 'state');
    connection.readyState = 3; assert.throws(() => peer.send('bad'), /关闭/);
    server.close(); assert.equal(connection.closed, true); assert.equal(native.stopped, true);
    assert.equal(closed, 1); assert.equal(failure, undefined);
    const late = { close() { this.closed = true; } }; native.onconnection(late); assert.equal(late.closed, true);
});
test('远程地址支持域名、IPv6、wss及代理路径，拒绝混入凭据或无效端口', async () => {
    let socket;
    class Socket {
        readyState = 1; bufferedAmount = 0;
        constructor(url) { this.url = url; socket = this; }
        close() { this.closed = true; }
        send(data) { this.sent = data; }
    }
    const a = adapter({ WebSocket: Socket });
    assert.equal(a.remoteAddress('wss://example.com'), 'wss://example.com/football');
    assert.equal(a.remoteAddress('ws://[2001:db8::1]:8766/football'), 'ws://[2001:db8::1]:8766/football');
    assert.equal(a.remoteAddress('wss://example.com/proxy/game'), 'wss://example.com/proxy/game');
    for (const invalid of ['http://example.com', 'ws://user:key@example.com', 'wss://example.com?key=secret',
        'ws://host:0', 'ws://host:65536', 'ws://[1::2::3]', 'ws://[1234]', 'ws://999.1.1.1', 'ws://bad..host'])
        assert.throws(() => a.remoteAddress(invalid));
    const attempt = a.connectRemote('wss://example.com/proxy/game'); socket.onopen(); const peer = await attempt.result;
    assert.equal(socket.url, 'wss://example.com/proxy/game');
    let received; peer.onMessage = data => received = data; socket.onmessage({ data: 'snapshot' });
    assert.equal(received, 'snapshot'); peer.send('hello'); assert.equal(socket.sent, 'hello'); peer.close();
});
