const http = require('node:http');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const path = require('node:path');

// 仅此入口依赖Node和ws；比赛、房间与Box2D适配器均来自共享TypeScript。
function loadDependencies() {
    try {
        const ws = require('ws');
        const version = require('ws/package.json').version.split('.').map(Number);
        if (version[0] !== 8 || version[1] < 21) throw new Error('ws版本须为8.21或更新的8.x');
        return { WebSocketServer: ws.WebSocketServer, WebSocket: ws.WebSocket, box2d: require('@cocos/box2d') };
    } catch (error) {
        throw new Error(`请先在项目根目录执行 npm --prefix server install --ignore-scripts --no-audit --no-fund。${error.message}`);
    }
}
function serverConfig(env) {
    const integer = (name, fallback, min, max) => {
        const v = env[name] === undefined ? fallback : Number(env[name]);
        if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${name}范围应为${min}—${max}`);
        return v;
    };
    const accessKey = env.FOOTBALL_ACCESS_KEY ?? crypto.randomBytes(16).toString('hex');
    if (!/^[\x21-\x7e]{12,128}$/.test(accessKey)) throw new Error('FOOTBALL_ACCESS_KEY须为12—128位不含空格的ASCII口令');
    const wsPath = env.FOOTBALL_WS_PATH ?? '/football';
    if (!/^\/[a-zA-Z0-9/_-]*$/.test(wsPath) || wsPath === '/healthz') throw new Error('FOOTBALL_WS_PATH无效');
    return { host: env.FOOTBALL_HOST ?? '0.0.0.0', port: integer('FOOTBALL_PORT', 8766, 0, 65535), path: wsPath,
        accessKey, maxRooms: integer('FOOTBALL_MAX_ROOMS', 4, 1, 16), maxConnections: integer('FOOTBALL_MAX_CONNECTIONS', 16, 2, 64) };
}
function socketPeer(socket, maxLength) {
    let closed = false;
    let rateCount = 0, rateStart = performance.now();
    const peer = {
        send(data) {
            if (closed || socket.readyState !== 1 || socket.bufferedAmount > maxLength * 4) throw new Error('连接关闭或发送拥塞');
            socket.send(data, error => { if (error) { peer.onClose?.(); peer.close(); } });
        },
        close() {
            if (closed) return;
            closed = true; socket.close();
            const timer = setTimeout(() => { if (socket.readyState !== 3) socket.terminate(); }, 1500); timer.unref();
        },
    };
    socket.on('message', (data, binary) => {
        if (closed) return;
        // 守住传输入口；包括未握手连接，不让任意消息无限占用主循环。
        const now = performance.now(); if (now - rateStart >= 1000) { rateStart = now; rateCount = 0; }
        if (binary || data.length > maxLength || ++rateCount > 40) { peer.onClose?.(); peer.close(); return; }
        peer.onMessage?.(data.toString('utf8'));
    });
    socket.on('close', () => { closed = true; peer.onClose?.(); });
    socket.on('error', () => { peer.onClose?.(); peer.close(); });
    return peer;
}
function createComputerServer({ WebSocketServer, box2d, config, runtime = path.resolve(__dirname, '../.server-output'), logger = console }) {
    const { RemoteGateway } = require(path.join(runtime, 'application/RemoteGateway.js'));
    const { LocalMatch } = require(path.join(runtime, 'application/LocalMatch.js'));
    const { Box2DPhysics } = require(path.join(runtime, 'adapters/physics/Box2DPhysics.js'));
    const { prototypeConfig, freezeConfig, createStandardMatchState } = require(path.join(runtime, 'core/PrototypeConfig.js'));
    const { parsePlayerCatalog, createPlayerConditions } = require(path.join(runtime, 'core/PlayerCatalog.js'));
    const { lanSettings } = require(path.join(runtime, 'core/LanProtocol.js'));
    const gameConfig = freezeConfig(prototypeConfig);
    const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
    const seed = () => crypto.randomBytes(4).readUInt32LE();
    const expectedKey = Buffer.from(config.accessKey);
    const gateway = new RemoteGateway({ config: gameConfig, catalog, maxRooms: config.maxRooms, maxConnections: config.maxConnections,
        authenticate: key => { const received = Buffer.from(key); return received.length === expectedKey.length && crypto.timingSafeEqual(received, expectedKey); },
        roomCode: () => crypto.randomBytes(3).toString('hex').toUpperCase(), roomId: () => `remote-${crypto.randomUUID()}`,
        conditions: () => createPlayerConditions(catalog, seed()), hooks: code => {
            let physics;
            return {
                createMatch(lineups, id, conditions) {
                    physics?.dispose();
                    const state = createStandardMatchState(id, gameConfig, seed(), catalog, lineups, conditions);
                    physics = new Box2DPhysics(box2d, gameConfig, state, catalog);
                    return new LocalMatch(state, physics, gameConfig);
                },
                ballAngle: () => physics?.getBallAngle() ?? 0,
                roomChanged() {}, ended(reason) { physics?.dispose(); physics = undefined; logger.log(`房间${code}已关闭：${reason}`); },
            };
        },
    });
    const httpServer = http.createServer((request, response) => {
        const health = request.method === 'GET' && request.url === '/healthz';
        response.writeHead(health ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(health ? '{"ok":true}' : '{"error":"not found"}');
    });
    httpServer.headersTimeout = 5000; httpServer.requestTimeout = 10000; httpServer.maxHeadersCount = 32;
    const wss = new WebSocketServer({ noServer: true, maxPayload: lanSettings.maxMessageLength,
        perMessageDeflate: false, maxFragments: 64, maxBufferedChunks: 64 });
    let timer, stopped = false;
    let bindPromise, listenPromise, closePromise;
    const sockets = new Set();
    httpServer.on('connection', socket => {
        if (sockets.size >= config.maxConnections * 2) { socket.destroy(); return; }
        sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    });
    httpServer.on('error', error => logger.error(`HTTP服务错误：${error.message}`));
    httpServer.on('upgrade', (request, socket, head) => {
        if (stopped || request.url !== config.path || gateway.getStats().connections >= config.maxConnections) {
            socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
        }
        wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
    });
    wss.on('connection', socket => gateway.attach(socketPeer(socket, lanSettings.maxMessageLength)));
    wss.on('error', error => logger.error(`WebSocket服务错误：${error.message}`));
    const close = () => {
        if (closePromise) return closePromise;
        stopped = true; if (timer) clearInterval(timer); gateway.close();
        // listen事件可能尚未到达；等本次绑定结束再关HTTP，防止关闭后又留下监听端口。
        closePromise = Promise.resolve().then(async () => {
            if (bindPromise) await bindPromise.catch(() => {});
            for (const socket of wss.clients) socket.terminate();
            for (const socket of sockets) socket.destroy();
            await new Promise(resolve => wss.close(() => resolve()));
            if (httpServer.listening) await new Promise(resolve => httpServer.close(() => resolve()));
        });
        return closePromise;
    };
    return {
        gateway,
        listen() {
            if (stopped) return Promise.reject(new Error('服务已关闭，请创建新的服务实例'));
            if (listenPromise) return listenPromise;
            bindPromise = new Promise((resolve, reject) => {
                const onError = error => { httpServer.off('listening', onListening); reject(error); };
                const onListening = () => { httpServer.off('error', onError); resolve(); };
                httpServer.once('error', onError); httpServer.once('listening', onListening);
                try { httpServer.listen(config.port, config.host); }
                catch (error) { httpServer.off('error', onError); httpServer.off('listening', onListening); reject(error); }
            });
            listenPromise = bindPromise.then(() => {
                if (stopped) throw new Error('服务已关闭，已取消本次启动');
                let previous = performance.now();
                timer = setInterval(() => {
                    const now = performance.now(); const delta = (now - previous) / 1000; previous = now;
                    try { gateway.tick(delta); } catch (error) { logger.error(`比赛服务异常：${error.message}`); void close(); }
                }, 1000 / 60);
                return httpServer.address();
            }).catch(async error => {
                await close();
                if (error.code === 'EADDRINUSE') {
                    const failure = new Error(`端口${config.port}已被占用，请关闭旧服务或设置FOOTBALL_PORT改用其他端口`, { cause: error });
                    failure.code = error.code; throw failure;
                }
                throw error;
            });
            return listenPromise;
        }, close,
    };
}
module.exports = { loadDependencies, createComputerServer, serverConfig, socketPeer };
