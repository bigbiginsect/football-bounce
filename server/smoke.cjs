const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createComputerServer, serverConfig } = require('./main.cjs');

/** 真实入口默认使用ws及HTTP；可注入传输边界以验证自检自身的超时/清理。 */
async function runSmokeTest(dependencies, { runtime = path.resolve(__dirname, '../.server-output'), logger = console,
    timeoutMs = 5000, createServer = createComputerServer, fetchHealth = globalThis.fetch } = {}) {
    const { LanClient } = require(path.join(runtime, 'application/LanClient.js'));
    const { prototypeConfig, freezeConfig } = require(path.join(runtime, 'core/PrototypeConfig.js'));
    const { parsePlayerCatalog } = require(path.join(runtime, 'core/PlayerCatalog.js'));
    const { defaultLineups } = require(path.join(runtime, 'core/Lineup.js'));
    const gameConfig = freezeConfig(prototypeConfig);
    const catalog = parsePlayerCatalog(require('../assets/resources/config/players.json'));
    // 自检不读取正常服务端口、口令及监听网卡，避免占用或暴露已有服务。
    const config = serverConfig({ FOOTBALL_HOST: '127.0.0.1', FOOTBALL_PORT: '0' });
    const sessions = [], sockets = [];
    let failure, cleaning = false, heartbeat, stage = '启动临时服务';
    const fail = reason => { if (!cleaning && !failure) failure = reason instanceof Error ? reason : new Error(String(reason)); };
    const waitFor = async predicate => {
        const deadline = performance.now() + timeoutMs;
        for (;;) {
            if (failure) throw failure;
            const result = predicate(); if (result) return result;
            if (performance.now() >= deadline) throw new Error('等待超时');
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };
    const server = createServer({ ...dependencies, config, runtime, logger: { log() {}, error: fail } });
    try {
        const address = await server.listen();
        const base = `http://127.0.0.1:${address.port}`;
        stage = 'HTTP健康检查';
        const response = await fetchHealth(`${base}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok || (await response.json()).ok !== true) throw new Error('健康检查响应无效');
        logger.log('HTTP健康检查通过');
        const connect = async (action, roomCode = '') => {
            const socket = new dependencies.WebSocket(`ws://127.0.0.1:${address.port}${config.path}`);
            sockets.push(socket);
            const peer = { send: data => {
                if (socket.readyState !== 1) throw new Error('自检连接未就绪'); socket.send(data);
            }, close: () => socket.terminate() };
            socket.on('error', fail);
            socket.on('close', () => { peer.onClose?.(); fail('自检连接提前断开'); });
            socket.on('message', (data, binary) => {
                if (binary) { fail('收到非文本协议消息'); return; }
                peer.onMessage?.(data.toString('utf8'));
            });
            await waitFor(() => socket.readyState === 1);
            const states = new Map();
            const client = new LanClient(peer, gameConfig, catalog, { welcomed() {}, roomChanged() {},
                snapshot: state => { states.set(state.revision, state); if (states.size > 32) states.delete(states.keys().next().value); },
                rejected: reason => fail(`操作被拒绝：${reason}`), ended: fail,
            }, { action, roomCode, accessKey: config.accessKey });
            sessions.push(client); client.start(); await waitFor(() => client.getRoom());
            return { client, states };
        };
        let previous = performance.now();
        heartbeat = setInterval(() => {
            const now = performance.now(), delta = (now - previous) / 1000; previous = now;
            for (const client of sessions) client.tick(delta);
        }, 100);
        stage = '蓝队创建房间'; const blue = await connect('Create');
        stage = '红队加入房间'; const red = await connect('Join', blue.client.getRoom().code);
        if (blue.client.side !== 'blue' || red.client.side !== 'red') throw new Error('服务分配席位错误');
        logger.log('双客户端建房与加入通过');
        const sharedFrame = phase => {
            for (const [revision, state] of blue.states) {
                const other = red.states.get(revision);
                if (state.phase !== phase || !other) continue;
                if (JSON.stringify(state) !== JSON.stringify(other)) throw new Error('两端权威快照不一致');
                return state;
            }
        };
        stage = '双方准备及首帧同步';
        const selection = { formationId: '2-1-2', templateIds: defaultLineups().blue.map(p => p.templateId) };
        blue.client.ready(selection); red.client.ready(selection);
        const state = await waitFor(() => sharedFrame('Aiming'));
        logger.log('双方准备与首帧一致性通过');
        stage = '权威发射及快照同步';
        const active = state.activeOperatorId === 'blue' ? blue.client : red.client;
        const player = state.players.find(p => p.ownerId === state.activeOperatorId);
        if (!active.launch({ type: 'Launch', matchId: state.matchId, turnNumber: state.turnNumber, commandId: 'smoke-shot',
            operatorId: state.activeOperatorId, playerId: player.instanceId, power: 0.3,
            direction: { x: 0, y: state.activeOperatorId === 'blue' ? 1 : -1 } })) throw new Error('未能提交发射');
        await waitFor(() => sharedFrame('Simulating'));
        logger.log('权威发射与双端快照同步通过');
    } catch (error) { throw new Error(`${stage}失败：${error.message}`, { cause: error }); }
    finally {
        cleaning = true; clearInterval(heartbeat);
        try {
            for (const client of sessions) client.close();
            for (const socket of sockets) socket.terminate();
        } finally { await server.close(); }
    }
}
module.exports = { runSmokeTest };
