import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, TONICS, stepTime } from '../src/audio/presets.js';
import { SOUND_LIBRARY, TRACKS, SOUND_VARIANTS, kitForPreset, resolveSound } from '../src/audio/library.js';

test('all presets contain in-range sequencer steps and valid tempos', () => {
  assert.equal(Object.keys(PRESETS).length, 4);
  for (const preset of Object.values(PRESETS)) {
    assert.ok(preset.bpm >= 60 && preset.bpm <= 200);
    for (const name of ['kick', 'snare', 'hat', 'openHat']) {
      assert.ok(preset[name].every(step => Number.isInteger(step) && step >= 0 && step < 16));
    }
    assert.ok(preset.bass.every(([s, n, length]) => s >= 0 && s < 16 && Number.isFinite(n) && length > 0));
  }
});
test('library provides every built-in instrument', () => {
  assert.equal(SOUND_LIBRARY.length, 42);
  assert.equal(new Set(SOUND_LIBRARY.map(s => s.id)).size, 42);
  assert.equal(TRACKS.length, 7);
  for (const track of TRACKS) {
    assert.equal(SOUND_VARIANTS[track.id].length, 6);
    for (const [id] of SOUND_VARIANTS[track.id]) assert.equal(resolveSound(track.id, id).id, id);
  }
  for (const preset of Object.keys(PRESETS)) {
    const kit = kitForPreset(preset);
    for (const track of TRACKS) assert.equal(resolveSound(track.id, kit[track.id]).family, track.id);
  }
});
test('swing alters odd steps only', () => {
  assert.equal(stepTime(2, 120, 0.2), stepTime(2, 120));
  assert.ok(stepTime(3, 120, 0.2) > stepTime(3, 120));
  assert.equal(TONICS.A, 45);
});
