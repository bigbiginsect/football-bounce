const http = require('node:http');
const { createHash } = require('node:crypto');

// 仅用于在真实TCP回环上测试Cocos形状的服务端适配器，不作为游戏服务器交付。
function frame(opcode, data = Buffer.alloc(0)) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
    header[0] = 0x80 | opcode;
    if (header.length === 2) header[1] = payload.length;
    else { header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    return Buffer.concat([header, payload]);
}
class LoopbackServer {
    sockets = new Set();
    listen(port, callback) {
        this.http = http.createServer();
        this.http.on('upgrade', (request, socket) => {
            const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
            socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
            this.sockets.add(socket);
            const connection = { readyState: 1,
                send: (data, cb) => socket.write(frame(1, data), error => cb?.(error?.message)),
                close: () => { connection.readyState = 3; socket.destroy(); },
            };
            let pending = Buffer.alloc(0);
            socket.on('data', chunk => {
                pending = Buffer.concat([pending, chunk]);
                while (pending.length >= 2) {
                    const opcode = pending[0] & 15, masked = Boolean(pending[1] & 128);
                    let length = pending[1] & 127, offset = 2;
                    if (length === 127) { socket.destroy(); return; }
                    if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
                    const start = offset + (masked ? 4 : 0);
                    if (pending.length < start + length) return;
                    const payload = Buffer.from(pending.subarray(start, start + length));
                    if (masked) for (let i = 0; i < length; i++) payload[i] ^= pending[offset + i % 4];
                    pending = pending.subarray(start + length);
                    if (opcode === 1) connection.onmessage?.(payload.toString('utf8'));
                    else if (opcode === 8) { socket.end(frame(8, payload)); return; }
                    else if (opcode === 9) socket.write(frame(10, payload));
                }
            });
            socket.on('error', error => connection.onerror?.(error.message));
            socket.on('close', () => { connection.readyState = 3; this.sockets.delete(socket); connection.onclose?.(); });
            this.onconnection?.(connection);
        });
        this.http.once('error', error => callback(error.message));
        this.http.listen(port, '127.0.0.1', () => { this.port = this.http.address().port; callback(); });
    }
    close(callback) {
        for (const socket of this.sockets) socket.destroy();
        this.http?.close(() => { this.onclose?.(); callback?.(); });
    }
}
module.exports = { LoopbackServer };
