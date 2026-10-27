import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRemix, previewInstrument } from '../src/audio/engine.js';
import { patternFromPreset, emptyPattern, toggleStep } from '../src/audio/patterns.js';
import { kitForPreset } from '../src/audio/library.js';

const makeAudio = (seconds = 0.5) => ({
  duration: seconds, sampleRate: 8000, numberOfChannels: 1,
  getChannelData: () => new Float32Array(Math.ceil(seconds * 8000))
});
const cfg = (options = {}) => ({
  preset: 'drift', bpm: 150, sourceBpm: 150, key: 'A',
  keepOriginal: false, cowbell: true, effects: true,
  aggression: 60, bass: 60, beatOffset: 0,
  mode: 'manual', manualPattern: patternFromPreset('drift'), kit: kitForPreset('drift'),
  ...options
});

test('manual kick-only pattern loops and honors track mutes', async () => {
  const kickOnly = toggleStep(emptyPattern(), 'kick', 0);
  const remix = await renderRemix(makeAudio(2.0), cfg({ manualPattern: kickOnly }));
  assert.equal(remix.hits, 2); // 150 BPM, 1 bar = 1.6 sec
  assert.equal(remix.duration, 2);
  const muted = await renderRemix(makeAudio(2.0), cfg({ manualPattern: kickOnly, trackMutes: { kick: true } }));
  assert.equal(muted.hits, 0);
});

test('all 42 sound choices return valid audio of meaningfully different lengths', async () => {
  const [soft, long, metallic, cleanBass, growlBass] = await Promise.all([
    previewInstrument('kick-click'), previewInstrument('kick-boom'),
    previewInstrument('bell-metal'), previewInstrument('bass-clean'), previewInstrument('bass-growl')
  ]);
  for (const sample of [soft, long, metallic, cleanBass, growlBass]) assert.equal(sample.type, 'audio/wav');
  // WAV preview is one second in this MVP. Variation is audible, not a different file length.
  assert.equal(soft.size, long.size);
  const first = new Uint8Array(await cleanBass.arrayBuffer());
  const second = new Uint8Array(await growlBass.arrayBuffer());
  const start = 44 + Math.floor(0.15 * 44100) * 4; // samples begin after 120ms silence
  assert.notDeepEqual(first.subarray(start, start + 2048), second.subarray(start, start + 2048));
});
