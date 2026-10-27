import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBufferToWav } from '../src/audio/wav.js';

test('writes valid stereo little-endian RIFF WAVE header', async () => {
  const buffer = {
    numberOfChannels: 2, sampleRate: 44100, length: 3,
    getChannelData(index) { return index ? new Float32Array([0.5, 0, -0.5]) : new Float32Array([0, 1, -1]); }
  };
  const blob = audioBufferToWav(buffer);
  assert.equal(blob.size, 56);
  const data = new DataView(await blob.arrayBuffer());
  const text = (start, count) => String.fromCharCode(...new Uint8Array(data.buffer, start, count));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 44100);
  assert.equal(data.getInt16(46, true), 16383);
});
