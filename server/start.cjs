const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function main() {
    const root = path.resolve(__dirname, '..');
    const compiler = require.resolve('typescript/bin/tsc', { paths: [__dirname, root] });
    const result = spawnSync(process.execPath, [compiler, '--project', path.join(root, 'tsconfig.server.json')], { stdio: 'inherit', cwd: root });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('服务端核心编译失败');
    const { loadDependencies, createComputerServer, serverConfig } = require('./main.cjs');
    const deps = loadDependencies();
    if (process.argv.includes('--smoke-test')) {
        await require('./smoke.cjs').runSmokeTest(deps);
        console.log('本机联机自检通过，临时服务已关闭。此结果不代表公网或手机验收通过。');
        return;
    }
    const config = serverConfig(process.env);
    if (process.argv.includes('--check')) {
        console.log(`服务依赖及核心编译通过。监听 ${config.host}:${config.port}，路径 ${config.path}（未启动监听）`);
        return;
    }
    const server = createComputerServer({ ...deps, config });
    const address = await server.listen();
    console.log(`足球弹弹乐电脑服务已启动：ws://<电脑可达地址>:${address.port}${config.path}`);
    console.log(`连接口令：${config.accessKey}`);
    console.log('两台手机使用同一服务器地址和口令；一方创建房间，再把房间码告诉另一方。');
    console.log('异地连接需要实际可达的公网地址或穿透入口。电脑需保持联网运行。按Ctrl+C停止。');
    const stop = () => server.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(`服务启动失败：${error.message}`); process.exitCode = 1; });
