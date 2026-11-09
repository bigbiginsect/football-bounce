const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { runSmokeTest } = require('../server/smoke.cjs');
const runtime = path.resolve(__dirname, '../.test-output');
const healthy = async () => ({ ok: true, json: async () => ({ ok: true }) });

test('联机自检流程使用真实Box2D与传输事件替身，成功后关闭服务和两个客户端', { timeout: 3000 }, async t => {
    let box2d;
    try { box2d = require(process.env.CREATOR_BOX2D_MODULE_PATH || '../server/node_modules/@cocos/box2d'); }
    catch { t.skip('需要Box2D依赖或CREATOR_BOX2D_MODULE_PATH'); return; }
    let wss, service;
    const sockets = [], messages = [];
    class Wss extends EventEmitter {
        clients = new Set(); stopped = false;
        constructor() { super(); wss = this; }
        close(callback) { this.stopped = true; setImmediate(callback); }
    }
    class Socket extends EventEmitter {
        readyState = 0;
        constructor() {
            super(); sockets.push(this);
            const remote = new EventEmitter(); remote.readyState = 1; remote.bufferedAmount = 0;
            remote.send = (data, callback) => { queueMicrotask(() => { if (this.readyState === 1) this.emit('message', Buffer.from(data), false); }); callback?.(); };
            remote.close = () => this.terminate(); remote.terminate = remote.close;
            this.remote = remote;
            queueMicrotask(() => {
                if (this.readyState === 3) return;
                this.readyState = 1; wss.clients.add(remote); wss.emit('connection', remote); this.emit('open');
            });
        }
        send(data) { queueMicrotask(() => { if (this.readyState === 1) this.remote.emit('message', Buffer.from(data), false); }); }
        terminate() {
            if (this.readyState === 3) return;
            this.readyState = 3; this.remote.readyState = 3; wss.clients.delete(this.remote);
            queueMicrotask(() => { this.remote.emit('close'); this.emit('close'); });
        }
    }
    const { createComputerServer } = require('../server/main.cjs');
    await runSmokeTest({ WebSocketServer: Wss, WebSocket: Socket, box2d }, { runtime, timeoutMs: 1000,
        fetchHealth: healthy, logger: { log: message => messages.push(message) },
        createServer: options => {
            assert.equal(options.config.host, '127.0.0.1'); assert.equal(options.config.port, 0);
            service = createComputerServer(options); t.after(() => service.close()); return service;
        },
    });
    assert.equal(sockets.length, 2); assert.ok(sockets.every(s => s.readyState === 3));
    assert.equal(wss.stopped, true); assert.deepEqual(service.gateway.getStats(), { rooms: 0, connections: 0 });
    assert.equal(messages.at(-1), '权威发射与双端快照同步通过');
});

function failureFixture() {
    let closes = 0, attempts = 0, terminated = false;
    class Socket extends EventEmitter {
        readyState = 0;
        constructor() { super(); attempts++; }
        terminate() { terminated = true; this.readyState = 3; }
    }
    return { Socket, get closes() { return closes; }, get attempts() { return attempts; }, get terminated() { return terminated; },
        options: { runtime, timeoutMs: 40, logger: { log() {} }, fetchHealth: healthy,
            createServer: () => ({ listen: async () => ({ port: 12345 }), close: async () => { closes++; } }) },
    };
}
test('健康检查连接失败时不继续建房，返回阶段原因并清理临时服务', async () => {
    const f = failureFixture();
    await assert.rejects(runSmokeTest({ WebSocket: f.Socket }, { ...f.options,
        fetchHealth: async () => { throw new Error('connect EACCES'); } }), /HTTP健康检查失败.*EACCES/);
    assert.equal(f.closes, 1); assert.equal(f.attempts, 0);
});
test('WebSocket连接未就绪会在期限内失败并终止连接，不把超时当成成功', async () => {
    const f = failureFixture();
    await assert.rejects(runSmokeTest({ WebSocket: f.Socket }, f.options), /蓝队创建房间失败.*等待超时/);
    assert.equal(f.attempts, 1); assert.equal(f.terminated, true); assert.equal(f.closes, 1);
});
test('服务拒绝首包时自检明确失败，退出时关闭客户端和服务', async () => {
    const f = failureFixture(); let terminated = false;
    class Socket extends EventEmitter {
        readyState = 1;
        send() { queueMicrotask(() => this.emit('message', Buffer.from('{"type":"Ended","reason":"测试拒绝"}'), false)); }
        terminate() { this.readyState = 3; terminated = true; }
    }
    await assert.rejects(runSmokeTest({ WebSocket: Socket }, f.options), /蓝队创建房间失败.*测试拒绝/);
    assert.equal(terminated, true); assert.equal(f.closes, 1);
});
