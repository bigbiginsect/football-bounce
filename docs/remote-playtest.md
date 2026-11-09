# 电脑服务与远程联机

远程模式已接入首版源码。真实Box2D和服务组合层测试通过；本机无法下载ws依赖，也无法进行TCP回环、Creator预览或Android异网验证，因此还不能把这一版视为已验证的远程APK。

## 电脑怎么启动

在运行服务的电脑上准备 **Node.js 22或以上及npm**，取得与手机构建相同的完整项目源码。服务端无需启动Creator界面，也不需要显卡；首次安装需要联网下载依赖。

在项目根目录终端执行：

```powershell
npm --prefix server install --ignore-scripts --no-audit --no-fund
node server/start.cjs --check
node server/start.cjs --smoke-test
node server/start.cjs
```

`--check`编译共享TypeScript并检查服务依赖，不监听端口。普通启动成功后会显示服务地址格式和本次生成的连接口令。窗口保持运行，Ctrl+C停止。只有实际出现“电脑服务已启动”才算启动成功；依赖未安装时会明确提示安装命令。

`--smoke-test`是一键本机联机自检（也可执行 `npm --prefix server run smoke`）：临时监听127.0.0.1随机端口，自动检查HTTP健康、两个WebSocket客户端创建/加入房间、双方准备、一次权威发射和相同快照。自检不读取正常服务的端口/口令/网卡配置，不接入已有房间；结束后关闭临时服务。每个协议等待默认最多5秒，失败返回非零退出码并标出失败阶段；只有清理完成后才输出“本机联机自检通过”。本机仍因缺ws依赖未跑通此命令，不把流程替身测试视为连通成功；即使将来本机自检通过，也不能替代公网和Android双机验收。

如果提示“端口8766已被占用”，先关闭之前运行的服务，或在当前PowerShell设置 `$env:FOOTBALL_PORT = '8767'` 再启动，手机地址也使用8767。不要反复打开多个同端口服务。本批已用真实HTTP绑定验证重复启动/关闭和端口释放；完整WebSocket及手机连接仍待验收。

首版使用 `ws 8.22.2`、与Creator对应的 `@cocos/box2d 1.0.2`、`TypeScript 5.9.3`；均在server子包中声明，不升级引擎或增加手机运行依赖。首次安装会生成 `server/package-lock.json`，在能下载的环境完成安装/复验后应随项目保留，再用 `npm --prefix server ci --ignore-scripts --no-audit --no-fund` 复现。本批无法联网生成该锁文件，不伪造依赖完整性数据。

## 手机怎么使用

1. 两台手机安装由同一版本源码构建的APK。模式菜单选择“远程联机 · 连接电脑服务”。本批协议升级到v2，旧附近联机v1安装包不能混用。
2. 两台填写**同一个可达的服务器地址**和电脑显示的**连接口令**。口令与房间码不同，不要把口令加在URL中。
3. A点“创建远程房间”，服务分配蓝队并显示六位房间码。
4. B填写这个房间码，点“加入远程房间”，服务分配红队。首版一间房只允许两人，可同时存在少量房间。
5. 各自选自己的五名球员和阵型，确认后等待双方准备完成，自动开赛。
6. 电脑计算物理、回合、技能、时钟、比分和结局，两台手机显示同一权威快照。手机可分别使用移动数据或各自的Wi-Fi，无需连接电脑所在Wi-Fi。
7. 比赛结束后点“再来一局”，双方重新确认阵容才开始。退出、断网/超时、切后台会中止本房间，不判负，不续接旧局；另一间房不受影响。

## 服务器地址从哪里来

| 场景 | 手机填写的地址 | 条件 |
| --- | --- | --- |
| 先在家里验证电脑服务 | `ws://电脑的局域网IPv4:8766/football` | 手机能访问该电脑；这一步仍是局域网验证 |
| 直接从外网访问 | `ws://可达公网地址:端口/football` | 有实际公网可达能力、正确转发/路由及访问规则；不能填192.168等内网地址 |
| 使用TLS反向代理或穿透入口 | `wss://入口域名/football` | 入口须支持WebSocket升级并转到电脑本地8766端口；按入口实际路径填写 |
| 公网IPv6 | `ws://[实际公网IPv6]:8766/football` | 双方网络具备相应IPv6可达能力，访问规则正确；方括号必须保留 |

以上都是格式示例，不是已为你配置的地址。电脑服务本身提供普通HTTP/WebSocket，不签发证书；`wss`需由TLS入口终止后转发。公共网络使用wss可保护连接口令与操作内容。简单把ws改成wss不会自动启用TLS。

公网可达方式取决于你家网络和现有入口。本批不租服务器、不注册穿透服务、不配置路由器/防火墙、不发送口令。电脑须保持开机、联网和服务运行，休眠会导致断线。外网入口配置完成前，“服务能启动”不等于“异地手机已能连接”。

## 可配置项

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| FOOTBALL_HOST | 0.0.0.0 | 监听IPv4网卡；仅供本机代理时可改127.0.0.1；IPv6依系统配置绑定:: |
| FOOTBALL_PORT | 8766 | 服务端口；0只用于自动化测试的临时端口 |
| FOOTBALL_WS_PATH | /football | WebSocket入口路径，须与手机地址及代理转发一致 |
| FOOTBALL_ACCESS_KEY | 启动时随机生成 | 12—128位无空格ASCII连接口令；每次重启随机口令会变化 |
| FOOTBALL_MAX_ROOMS | 4 | 同时房间上限，允许1—16 |
| FOOTBALL_MAX_CONNECTIONS | 16 | 活跃/待握手WebSocket连接总上限，允许2—64 |

PowerShell设置示例：

```powershell
$env:FOOTBALL_PORT = '8766'
$env:FOOTBALL_HOST = '0.0.0.0'
node server/start.cjs
```

若需固定连接口令，可在当前终端设置FOOTBALL_ACCESS_KEY；不要把真实口令写入仓库、URL或公开文档。没有设置时使用启动窗口显示的随机口令即可。`GET /healthz`只返回健康标志，不返回口令、房间或比赛状态。

## 实际验收与当前证据

```powershell
node node_modules/typescript/bin/tsc --project tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --project tsconfig.core.json
node node_modules/typescript/bin/tsc --project tsconfig.server.json
node --test tests/*.test.cjs
git diff --check
```

装好server依赖后，真实物理测试自动使用server/node_modules下的Box2D。也可用CREATOR_BOX2D_MODULE_PATH指向已经安装的Creator对应模块；不把本机绝对路径写进共享配置。真实网络测试仅在依赖可用、操作系统允许TCP连接时执行，否则明确跳过。

| 检查 | 本批状态 |
| --- | --- |
| 共享规则/协议、两个远程席位、口令/版本/房间码、准备/终局/重开、房间隔离、超时 | 自动化通过 |
| 真实Box2D冲量/碰撞、进球复位、接触事件、状态恢复和释放 | 使用已安装Creator的1.0.2模块通过 |
| 电脑入口组合层与双客户端完整运动回合 | 真实Box2D + WebSocket事件替身通过；不是TCP验证 |
| server依赖安装及正式启动 | 受阻：本机npm入口不可用，访问registry.npmjs.org解析返回ENOTFOUND，ws未安装 |
| 真实HTTP/WebSocket回环 | 待验：远程测试因缺ws依赖跳过；附近回环预检仍因EACCES跳过 |
| Creator导入/meta/实际菜单、同机和附近回归 | 待验：本批启动仍异常退出 |
| Android APK与两台手机异网连接 | 未执行：无本批APK、设备及已配置的公网入口 |

最终至少验证：不同网络两手机创建/加入、各自选人、连续双方发射、比分/时钟/进球复位/终局一致、双方重开、错误口令/满房提示、切后台和断网、服务停止、另一房间不受影响。Web预览、事件替身和本地协议测试都不能关闭这些验收。
