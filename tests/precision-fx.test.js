import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineEvent, normalizeTimeline, nudgeTimelineEvent } from '../src/audio/timeline.js';
import { renderHitPCM, hitDuration, hitTotalDuration, sourcePlaybackRate, sourceFxSettings } from '../src/audio/hitEffects.js';
import { renderRemix, synthesizeInstrument } from '../src/audio/engine.js';

const config = {
  mode: 'timeline', preset: 'drift', bpm: 150, sourceBpm: 150,
  aggression: 80, bass: 85, key: 'A', keepOriginal: true,
  sourcePitch: 0, sourceTone: 100, sourceLowCut: 0, sourceLevel: 100
};
function clip(time = 0.2, extra = {}) {
  return createTimelineEvent({ track: 'bass', soundId: 'bass-growl',
    time, durationSeconds: 1.25, pitchFx: 'rise', pitchAmount: 9, echo: 35, ...extra });
}
const input = length => ({
  duration: length, sampleRate: 8000, numberOfChannels: 1,
  getChannelData() { return new Float32Array(Math.round(length * 8000)); }
});

test('Delete precision helpers move 10ms and 100ms without modifying original', () => {
  const hit = clip(20);
  const a = nudgeTimelineEvent([hit], hit.id, -0.01, 30);
  const b = nudgeTimelineEvent(a, hit.id, 0.1, 30);
  assert.equal(a[0].time, 19.99);
  assert.equal(b[0].time, 20.09);
  assert.equal(hit.time, 20);
  assert.equal(nudgeTimelineEvent([hit], hit.id, -200, 30)[0].time, 0);
});
test('timeline FX validates and preserves one-shot settings on import', () => {
  const a = clip();
  const result = normalizeTimeline([a]);
  assert.equal(result[0].durationSeconds, 1.25);
  assert.equal(result[0].pitchFx, 'rise');
  assert.equal(result[0].echo, 35);
  assert.throws(() => normalizeTimeline([{ ...a, durationSeconds: 20 }]), /duration/);
  assert.throws(() => normalizeTimeline([{ ...a, echo: 101 }]), /echo/);
  assert.throws(() => normalizeTimeline([{ ...a, pitchFx: 'random' }]), /pitch/);
  const old = normalizeTimeline([{ id: 'legacy', track: 'kick', time: 1 }]);
  assert.equal(old[0].durationSeconds, null);
});
test('long hit stretches a single sample, pitch sweep and echo change its wave', () => {
  const dry = clip(.1, { echo: 0, pitchFx: 'flat' });
  const wet = clip(.1, { echo: 65, pitchFx: 'rise' });
  const a = renderHitPCM(dry, config, synthesizeInstrument);
  const b = renderHitPCM(wet, config, synthesizeInstrument);
  assert.equal(a.length, Math.round(1.25 * 44100));
  assert.ok(b.length > a.length, 'echo includes finite decaying tail');
  assert.ok(a.slice(1000, 4000).some((value, i) => value !== b[i + 1000]));
  assert.equal(hitDuration(dry, config.bpm), 1.25);
  assert.ok(hitTotalDuration(wet) > 1.25);
});
test('source pitch global control reports exact speed ratio and tone settings', () => {
  assert.equal(sourcePlaybackRate(config), 1);
  assert.equal(sourcePlaybackRate({ ...config, sourcePitch: 12 }), 2);
  assert.equal(sourcePlaybackRate({ ...config, sourcePitch: -12 }), 0.5);
  const dark = sourceFxSettings({ ...config, sourceTone: 0, sourceLowCut: 100, sourceLevel: 50 });
  assert.ok(dark.cutoff <= 351);
  assert.ok(dark.highpass >= 799);
  assert.equal(dark.volume, 0.24);
});
test('offline render uses extended pitched hit at absolute timestamp and pitch-adjusted source length', async () => {
  const hit = clip(.4);
  const progress = [];
  const render = await renderRemix(input(3), { ...config, timelineEvents: [hit] }, p => progress.push(p));
  assert.equal(render.hits, 1);
  assert.equal(render.duration, 3);
  assert.equal(progress.at(-1), 100);
  const wav = await render.blob.arrayBuffer();
  const pcm = new Int16Array(wav, 44);
  const peak = (a, b) => {
    let value = 0;
    for (let i = Math.floor(a * 44100); i < Math.floor(b * 44100); i++)
      value = Math.max(value, Math.abs(pcm[i * 2]));
    return value;
  };
  assert.equal(peak(.02, .12), 0);
  assert.ok(peak(.44, .50) > 0);
  const changed = await renderRemix(input(3), {
    ...config, timelineEvents: [], sourcePitch: 12
  });
  assert.equal(changed.duration, 1.5);
});
