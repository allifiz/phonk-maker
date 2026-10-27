import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRemix, previewInstrument, MAX_RENDER_SECONDS } from '../src/audio/engine.js';

const testSource = (duration, rate = 8000) => ({
  duration,
  sampleRate: rate,
  numberOfChannels: 1,
  getChannelData() {
    return new Float32Array(Math.ceil(duration * rate));
  }
});

test('fast render returns a full stereo WAV, including a progress update', async () => {
  const progress = [];
  const result = await renderRemix(testSource(0.75), {
    preset: 'drift', sourceBpm: 120, bpm: 120,
    keepOriginal: true, aggression: 80, bass: 80, key: 'A',
    beatOffset: 0, effects: true, cowbell: true
  }, value => progress.push(value));
  assert.equal(result.truncated, false);
  assert.ok(result.hits > 0);
  assert.equal(progress.at(-1), 100);
  assert.equal(result.duration, 0.75);
  const wav = new DataView(await result.blob.arrayBuffer());
  assert.equal(result.blob.size, 44 + Math.floor(0.75 * 44100) * 4);
  assert.equal(wav.getUint32(24, true), 44100);
  assert.equal(wav.getUint16(22, true), 2);
});

test('longer tracks are rejected explicitly instead of being silently cut', async () => {
  await assert.rejects(() => renderRemix(testSource(MAX_RENDER_SECONDS + 0.5), {
    preset: 'drift', sourceBpm: 150, bpm: 150
  }), /up to 15 minutes/);
});

test('cancelled render can be stopped before allocation', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => renderRemix(testSource(0.5), {
    preset: 'memphis', sourceBpm: 120, bpm: 120,
    keepOriginal: false, aggression: 50, bass: 70, key: 'A',
    beatOffset: 0, effects: true, cowbell: true
  }, () => {}, controller.signal), { name: 'AbortError' });
});

test('built-in drum audition encodes a playable WAV', async () => {
  const blob = await previewInstrument('kick');
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 44 + 44100 * 4);
});
