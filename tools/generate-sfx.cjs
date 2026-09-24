const fs = require('node:fs');
const path = require('node:path');

const sampleRate = 44100;
const output = path.resolve(__dirname, '..', 'assets', 'resources', 'sfx');

function envelope(time, duration, attack = 0.01, release = 0.08) {
  return Math.min(1, time / attack) * Math.min(1, (duration - time) / release);
}

function writeWave(name, duration, sample) {
  const count = Math.ceil(sampleRate * duration);
  const dataBytes = count * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < count; index++) {
    const time = index / sampleRate;
    const value = Math.max(-1, Math.min(1, sample(time, duration)));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  fs.writeFileSync(path.join(output, `${name}.wav`), buffer);
}

function tone(frequency, time, phase = 0) { return Math.sin(Math.PI * 2 * frequency * time + phase); }
function noteSequence(notes, noteDuration, time) {
  const index = Math.min(notes.length - 1, Math.floor(time / noteDuration));
  const local = time - index * noteDuration;
  return tone(notes[index], local) * envelope(local, noteDuration, 0.008, 0.07);
}

fs.mkdirSync(output, { recursive: true });

writeWave('launch', 0.16, (time, duration) => {
  const progress = time / duration;
  const frequency = 230 + progress * 520;
  return tone(frequency, time) * envelope(time, duration, 0.006, 0.08) * 0.42;
});

let noiseState = 0x6d2b79f5;
writeWave('collision', 0.11, (time, duration) => {
  noiseState ^= noiseState << 13; noiseState ^= noiseState >>> 17; noiseState ^= noiseState << 5;
  const noise = ((noiseState >>> 0) / 0x80000000) - 1;
  return (tone(115, time) * 0.72 + noise * 0.28) * envelope(time, duration, 0.002, 0.09) * 0.55;
});

writeWave('goal', 0.72, (time, duration) => {
  const melody = noteSequence([523.25, 659.25, 783.99, 1046.5], 0.18, time);
  return melody * envelope(time, duration, 0.008, 0.1) * 0.48;
});

writeWave('timeout', 0.42, (time, duration) => {
  const active = (time < 0.13 || (time >= 0.21 && time < 0.34));
  if (!active) return 0;
  const local = time < 0.13 ? time : time - 0.21;
  return tone(time < 0.13 ? 620 : 520, local) * envelope(local, 0.13, 0.004, 0.04) * 0.4;
});

writeWave('finish', 0.82, (time, duration) => {
  const root = time < 0.36 ? 392 : 523.25;
  const chord = tone(root, time) + tone(root * 1.25, time) * 0.65 + tone(root * 1.5, time) * 0.5;
  return chord / 2.15 * envelope(time, duration, 0.015, 0.22) * 0.42;
});

console.log(`Generated 5 WAV files in ${output}`);
