export const AUDIO_RATE = 44100;
export const MAX_HIT_SECONDS = 6;
export const HIT_DURATIONS = {
  kick: 0.32, snare: 0.25, hat: 0.09, openHat: 0.45,
  bass: 0.65, bell: 0.45, impact: 0.9
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export function hitDuration(event, bpm = 150) {
  const explicit = Number(event.durationSeconds);
  if (Number.isFinite(explicit) && explicit >= 0.05) return clamp(explicit, 0.05, MAX_HIT_SECONDS);
  const steps = Number(event.steps) || 2;
  return clamp(steps * 60 / Math.max(60, Number(bpm) || 150) / 4 * 0.86, 0.05, MAX_HIT_SECONDS);
}
export function hitTotalDuration(event, bpm = 150) {
  const duration = hitDuration(event, bpm);
  return duration + ((Number(event.echo) || 0) > 0 ? 4 * 0.23 : 0);
}

/**
 * Original procedural one-shot, transformed ONCE. Changing duration stretches
 * its PCM envelope with interpolation, never copies/retriggers the hit.
 * Rise/Drop bends its instantaneous playback position non-linearly. The
 * integral is normalized to consume the source sample exactly once.
 * Subsequent decaying delay taps are echo, not beat looping.
 */
export function renderHitPCM(event, config, synthesizeInstrument) {
  const seconds = hitDuration(event, config.bpm);
  const input = synthesizeInstrument(event.soundId, config, event.note || 0, seconds);
  const length = Math.max(2, Math.round(seconds * AUDIO_RATE));
  const samples = new Float32Array(length);
  const mode = event.pitchFx || 'flat';
  const pitchAmount = clamp(Number(event.pitchAmount) || 0, 0, 12);
  const pitchStart = mode === 'rise' ? -pitchAmount : mode === 'drop' ? pitchAmount : 0;
  const pitchEnd = mode === 'rise' ? pitchAmount : mode === 'drop' ? -pitchAmount : 0;
  let total = 0;
  const speeds = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const u = i / Math.max(1, length - 1);
    const semitones = pitchStart + (pitchEnd - pitchStart) * u;
    const rate = 2 ** (semitones / 12);
    speeds[i] = rate;
    total += rate;
  }
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const index = Math.min(input.length - 1, phase / total * Math.max(0, input.length - 1));
    const j = Math.floor(index);
    const frac = index - j;
    const sample = input[j] * (1 - frac) + (input[Math.min(j + 1, input.length - 1)] || 0) * frac;
    const time = i / AUDIO_RATE;
    const attack = Math.min(1, time / 0.004);
    const decay = Math.max(0, Math.min(1, (seconds - time) / Math.min(0.15, seconds * 0.3)));
    samples[i] = sample * attack * decay;
    phase += speeds[i];
  }
  const echo = clamp(Number(event.echo) || 0, 0, 100) / 100;
  if (echo === 0) return samples;
  const taps = 4;
  const spacing = Math.round(0.23 * AUDIO_RATE);
  const out = new Float32Array(length + spacing * taps);
  out.set(samples);
  for (let tap = 1; tap <= taps; tap++) {
    const amount = echo * (0.54 ** tap);
    if (amount < 0.001) continue;
    const start = spacing * tap;
    for (let i = 0; i < samples.length; i++) out[start + i] += samples[i] * amount;
  }
  return out;
}

export function sourceFxSettings(config) {
  return {
    volume: clamp(Number(config.sourceLevel ?? 100), 0, 150) / 100 * (config.keepOriginal ? 0.48 : 0),
    cutoff: 350 * (18000 / 350) ** (clamp(Number(config.sourceTone ?? 100), 0, 100) / 100),
    highpass: 20 * (800 / 20) ** (clamp(Number(config.sourceLowCut ?? 0), 0, 100) / 100)
  };
}

/* Global source pitch uses playback-rate shifting, so it ALSO changes
 * duration/tempo. This is deliberate for the lightweight offline MVP.
 */
export function sourcePlaybackRate(config) {
  const bpm = Math.min(210, Math.max(60, Number(config.bpm) || 150));
  const sourceBpm = Math.min(240, Math.max(50, Number(config.sourceBpm) || bpm));
  const pitch = Math.min(12, Math.max(-12, Number(config.sourcePitch) || 0));
  return bpm / sourceBpm * 2 ** (pitch / 12);
}
