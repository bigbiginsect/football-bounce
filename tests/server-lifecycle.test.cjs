const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createComputerServer, serverConfig } = require('../server/main.cjs');

// 使用真实HTTP绑定验证端口生命周期；不建立TCP客户端，不替代ws或手机连接测试。
function fixture(t, port = 0) {
    let wss;
    class Wss extends EventEmitter {
        clients = new Set(); closeCalls = 0;
        constructor() { super(); wss = this; }
        close(callback) { this.closeCalls++; setImmediate(() => callback?.()); }
    }
    const server = createComputerServer({ WebSocketServer: Wss, box2d: {},
        config: serverConfig({ FOOTBALL_HOST: '127.0.0.1', FOOTBALL_PORT: String(port), FOOTBALL_ACCESS_KEY: 'lifecycle-test-12345' }),
        runtime: path.resolve(__dirname, '../.test-output'), logger: { log() {}, error() {} } });
    t.after(() => server.close()); return { server, get wss() { return wss; } };
}
function bind(server, port = 0) {
    return new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', started); reject(error); };
        const started = () => { server.off('error', failed); resolve(server.address()); };
        server.once('error', failed); server.once('listening', started); server.listen(port, '127.0.0.1');
    });
}
async function canBind(t) {
    const probe = http.createServer();
    try { await bind(probe); }
    catch (error) {
        if (['EACCES', 'EPERM'].includes(error.code)) { t.skip('当前环境禁止监听HTTP端口'); return false; }
        throw error;
    }
    await new Promise(resolve => probe.close(resolve)); return true;
}
async function assertPortFree(port) {
    const probe = http.createServer();
    await bind(probe, port); await new Promise(resolve => probe.close(resolve));
}

test('重复启动返回同一监听端口，不能关闭原服务；重复停止等待同一清理', { timeout: 3000 }, async t => {
    if (!await canBind(t)) return;
    const f = fixture(t);
    const first = await f.server.listen(); const second = await f.server.listen();
    assert.deepEqual(second, first);
    const competitor = http.createServer();
    await assert.rejects(bind(competitor, first.port), { code: 'EADDRINUSE' });
    const closing = f.server.close(), closingAgain = f.server.close();
    assert.equal(closingAgain, closing); await closingAgain;
    assert.equal(f.wss.closeCalls, 1); await assertPortFree(first.port);
    await assert.rejects(f.server.listen(), /已关闭/);
});
test('启动中立刻停止，不允许延迟绑定后残留端口或启动计时器', { timeout: 3000 }, async t => {
    if (!await canBind(t)) return;
    const reservation = http.createServer(); const address = await bind(reservation);
    await new Promise(resolve => reservation.close(resolve));
    const f = fixture(t, address.port);
    const starting = f.server.listen();
    // 先挂上拒绝处理，覆盖停止与listening事件到达顺序之间的竞争。
    const rejected = assert.rejects(starting, /已关闭/);
    await f.server.close(); await rejected;
    assert.equal(f.wss.closeCalls, 1); await assertPortFree(address.port);
    assert.deepEqual(f.server.gateway.getStats(), { rooms: 0, connections: 0 });
});
test('并发启动合并为一次监听，端口占用给出修改FOOTBALL_PORT的明确提示', { timeout: 3000 }, async t => {
    if (!await canBind(t)) return;
    const f = fixture(t);
    const [a, b] = await Promise.all([f.server.listen(), f.server.listen()]); assert.deepEqual(a, b);
    const conflict = fixture(t, a.port);
    await assert.rejects(conflict.server.listen(), error =>
        error.code === 'EADDRINUSE' && error.message.includes(String(a.port)) && error.message.includes('FOOTBALL_PORT'));
    assert.equal(conflict.wss.closeCalls, 1);
    const third = await f.server.listen(); assert.equal(third.port, a.port);
    await f.server.close(); await assertPortFree(a.port);
});
test('从未启动也可重复停止，关闭后不能重新监听', async t => {
    const f = fixture(t); const first = f.server.close(), second = f.server.close();
    assert.equal(first, second); await second; assert.equal(f.wss.closeCalls, 1);
    await assert.rejects(f.server.listen(), /已关闭/);
});
