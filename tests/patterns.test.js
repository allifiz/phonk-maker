import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPattern, normalizePattern, patternFromPreset, setStepLength, setStepNote,
  toggleStep, normalizeKit, normalizeTrackValues, DEFAULT_TRACK_GAINS, DEFAULT_TRACK_MUTES
} from '../src/audio/patterns.js';

test('default preset converts to a manual 16-step groove', () => {
  const p = patternFromPreset('drift');
  assert.ok(p.kick.includes(0));
  assert.ok(p.bass.some(note => note[0] === 0));
  assert.equal(p.impact[0], 0);
});
test('step toggles on/off without mutation', () => {
  const initial = emptyPattern();
  const added = toggleStep(initial, 'kick', 5);
  assert.deepEqual(initial.kick, []);
  assert.deepEqual(added.kick, [5]);
  assert.deepEqual(toggleStep(added, 'kick', 5).kick, []);
  assert.deepEqual(toggleStep(initial, 'bass', 7).bass, [[7, 0, 2]]);
});
test('bass note and length editing keeps steps intact', () => {
  const withBass = toggleStep(emptyPattern(), 'bass', 4);
  const changed = setStepLength(setStepNote(withBass, 'bass', 4, -5), 4, 6);
  assert.deepEqual(changed.bass, [[4, -5, 6]]);
  assert.deepEqual(withBass.bass, [[4, 0, 2]]);
});
test('invalid or oversized pattern files are rejected', () => {
  const pattern = patternFromPreset('brazil');
  assert.deepEqual(normalizePattern(pattern), pattern);
  assert.throws(() => normalizePattern({ ...pattern, kick: [1, 1] }), /duplicate/);
  assert.throws(() => normalizePattern({ ...pattern, bass: [[0, 100, 2]] }), /note/);
  assert.throws(() => normalizePattern({ ...pattern, hat: Array(100).fill(1) }), /Invalid/);
  assert.throws(() => normalizePattern({}), /Invalid/);
});
test('imported kit and mixer values cannot escape allowed ranges', () => {
  const kit = normalizeKit({ kick: 'bass-growl', snare: 'snare-rim' });
  assert.equal(kit.kick, 'kick');
  assert.equal(kit.snare, 'snare-rim');
  const gains = normalizeTrackValues({ kick: 200, bass: -11 }, DEFAULT_TRACK_GAINS, 0, 150, true);
  assert.equal(gains.kick, 150);
  assert.equal(gains.bass, 0);
  const mutes = normalizeTrackValues({ kick: true, snare: 2 }, DEFAULT_TRACK_MUTES, 0, 1, false);
  assert.equal(mutes.kick, true);
  assert.equal(mutes.snare, false);
});
