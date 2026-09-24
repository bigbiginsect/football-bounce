const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const directory = path.resolve(__dirname, '..', 'assets', 'resources', 'sfx');

test('五个基础音效是可导入的单声道 PCM WAV', () => {
  for (const name of ['launch', 'collision', 'goal', 'timeout', 'finish']) {
    const data = fs.readFileSync(path.join(directory, `${name}.wav`));
    assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(data.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(data.readUInt16LE(20), 1);
    assert.equal(data.readUInt16LE(22), 1);
    assert.equal(data.readUInt32LE(24), 44100);
    assert.equal(data.readUInt16LE(34), 16);
    assert.ok(data.length > 4000);
  }
});
