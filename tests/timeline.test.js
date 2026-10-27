import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimelineEvent, normalizeTimeline, moveTimelineEvent,
  snapSeconds, secondsLabel, MAX_TIMELINE_EVENTS
} from '../src/audio/timeline.js';
import { renderRemix, synthesizeInstrument } from '../src/audio/engine.js';

const base = {
  preset: 'drift', mode: 'timeline', key: 'A',
  bpm: 150, sourceBpm: 150, keepOriginal: false,
  aggression: 80, bass: 80, cowbell: true, effects: true,
  beatOffset: 0
};
const silentSource = seconds => ({
  duration: seconds, sampleRate: 8000, numberOfChannels: 1,
  getChannelData: () => new Float32Array(Math.ceil(seconds * 8000))
});
const at = (track, time, soundId = track) => createTimelineEvent({ track, time, soundId });

test('timeline accepts different synth variations and absolute second offsets', () => {
  const clips = normalizeTimeline([at('bass', 8.50, 'bass-growl'), at('snare', 3.25, 'snare-tight')]);
  assert.equal(clips[0].time, 3.25);
  assert.equal(clips[1].time, 8.5);
  assert.equal(clips[1].soundId, 'bass-growl');
  assert.equal(secondsLabel(83.5), '1:23');
});
test('timeline drag movement preserves hit identity and validates track', () => {
  const initial = [at('kick', 1.25, 'kick-click')];
  const moved = moveTimelineEvent(initial, initial[0].id, 12.35, 'kick');
  assert.equal(moved[0].id, initial[0].id);
  assert.equal(moved[0].time, 12.35);
  const crossTrack = moveTimelineEvent(initial, initial[0].id, 0.25, 'snare');
  assert.equal(crossTrack[0].soundId, 'snare');
  assert.equal(initial[0].time, 1.25);
});
test('invalid timeline files cannot schedule negative/NaN/out-of-bounds clips', () => {
  assert.throws(() => normalizeTimeline([{ id: 'x', track: 'kick', time: NaN }]), /Invalid event time/);
  assert.throws(() => normalizeTimeline([{ id: 'x', track: 'kick', time: -3 }]), /Invalid event time/);
  assert.throws(() => normalizeTimeline([{ id: 'x', track: 'kick', time: 2000 }]), /Invalid event time/);
  assert.throws(() => normalizeTimeline([{ id: 'x', track: 'script', time: 1 }]), /track/);
  assert.throws(() => normalizeTimeline(Array.from({ length: MAX_TIMELINE_EVENTS + 1 }, (_, i) => ({ id: String(i), track: 'kick', time: 1 }))), /oversized/);
});
test('snap is optional and maps playhead to 16th notes', () => {
  assert.equal(snapSeconds(1.12, 120, false), 1.12);
  assert.equal(snapSeconds(1.12, 120, true), 1.125);
});
test('offline export schedules timeline hits at their actual second coordinates', async () => {
  const timelineEvents = [at('kick', 0.2, 'kick-low'), at('snare', 2.6, 'snare-rim'), at('bass', 3.0, 'bass-growl')];
  const progress = [];
  const result = await renderRemix(silentSource(3.7), { ...base, timelineEvents }, x => progress.push(x));
  assert.equal(result.hits, 3);
  assert.equal(progress.at(-1), 100);
  const view = new DataView(await result.blob.arrayBuffer());
  assert.equal(view.getUint32(24, true), 44100);
  const pcm = new Int16Array(await result.blob.arrayBuffer(), 44);
  const peakBetween = (start, end) => {
    let peak = 0;
    for (let i = Math.floor(start * 44100); i < Math.floor(end * 44100); i++) peak = Math.max(peak, Math.abs(pcm[i * 2]));
    return peak;
  };
  assert.equal(peakBetween(0.01, 0.10), 0);
  assert.ok(peakBetween(0.21, 0.27) > 0);
  assert.equal(peakBetween(2.30, 2.45), 0);
  assert.ok(peakBetween(2.61, 2.65) > 0);
});
test('mute and sound variants affect the final output', async () => {
  const event = at('kick', 0.15, 'kick-low');
  const muted = await renderRemix(silentSource(.8), { ...base, timelineEvents: [event], trackMutes: { kick: true } });
  assert.equal(muted.hits, 0);
  const sampleA = synthesizeInstrument('kick-low', base);
  const sampleB = synthesizeInstrument('kick-click', base);
  assert.notEqual(sampleA.length, sampleB.length);
  assert.notEqual(sampleA[4410], sampleB[4410]);
});
