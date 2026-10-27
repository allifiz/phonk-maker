import { PRESETS, TONICS, stepTime } from './presets.js';
import { SOUND_INDEX, resolveSound, kitForPreset } from './library.js';
import { normalizePattern } from './patterns.js';
import { normalizeTimeline } from './timeline.js';

// This renderer uses reusable PCM samples and bounded chunks rather than
// constructing thousands of AudioNodes for a single OfflineAudioContext.
// Only the source AudioBuffer, cached one-shots and encoded WAV chunks survive.
const RATE = 44100;
const CHUNK_FRAMES = RATE * 3;
export const MAX_RENDER_SECONDS = 15 * 60;
const clamp = (x, min, max) => Math.max(min, Math.min(max, x));
const midiHz = midi => 440 * 2 ** ((midi - 69) / 12);
const TWO_PI = Math.PI * 2;

export async function decodeMusic(file) {
  if (!file || !/\.(wav|mp3|ogg|m4a|aac|flac)$/i.test(file.name)) {
    throw new Error('Choose an MP3, WAV, OGG, M4A, AAC, or FLAC audio file.');
  }
  if (file.size > 100 * 1024 * 1024) throw new Error('Maximum source size is 100 MB.');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('This audio format could not be decoded on your machine. Try WAV or MP3.');
  } finally {
    await ctx.close();
  }
}

function noiseGenerator(seed = 19571) {
  let state = seed | 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state | 0) / 2147483648;
  };
}

function synthesize(soundId, config, note = 0, duration = 0.2) {
  const sound = SOUND_INDEX[soundId] || SOUND_INDEX.kick;
  const id = sound.family;
  const variant = sound.variant;
  const aggression = clamp(Number(config.aggression) || 0, 0, 100) / 100;
  const tonic = TONICS[config.key] ?? TONICS.A;
  const lengthSeconds = {
    kick: [0.29, 0.43, 0.18, 0.46, 0.21, 0.25][variant],
    snare: [0.22, 0.12, 0.39, 0.12, 0.24, 0.3][variant],
    hat: [0.09, 0.13, 0.045, 0.13, 0.1, 0.08][variant],
    openHat: [0.38, 0.63, 0.22, 0.48, 0.49, 0.42][variant],
    bass: clamp(duration + (variant === 4 ? 0.01 : 0.05), 0.10, variant === 4 ? 0.5 : 2.0),
    bell: [0.22, 0.39, 0.42, 0.12, 0.47, 0.24][variant],
    impact: [0.85, 1.15, 0.95, 0.42, 0.85, 0.95][variant]
  }[id];
  if (!lengthSeconds) throw new Error('Unknown sound: ' + soundId);
  const size = Math.ceil(lengthSeconds * RATE);
  const wave = new Float32Array(size);
  const rand = noiseGenerator(id.length * 901 + note * 31 + variant * 314159 + 4181);
  const bassHz = midiHz(tonic - 12 + note);
  const bellHz = midiHz(tonic + 24 + note + (variant === 4 ? -12 : 0));
  const bellRatios = [1.47, 1.3, 1.81, 1.5, 1.32, 1.66];
  const bellA = TWO_PI * bellHz / RATE;
  const bellB = TWO_PI * bellHz * bellRatios[variant] / RATE;
  const bassStep = TWO_PI * bassHz / RATE;
  const kickTuning = [43, 35, 54, 38, 47, 58][variant];
  const kickDecay = [18, 10, 36, 11, 26, 20][variant];
  const kickClick = [0.2, 0.08, 0.45, 0.15, 0.055, 0.55][variant];
  const snareDecay = [19, 37, 9, 45, 18, 14][variant];
  const snareTone = [178, 220, 143, 355, 155, 199][variant];
  let kickPhase = 0;
  let impactPhase = 0;
  let highpassPrevious = 0;
  let lowpassPrevious = 0;
  const attackFade = 100;
  for (let i = 0; i < size; i++) {
    const t = i / RATE;
    const u = i / size;
    let value = 0;
    if (id === 'kick') {
      const frequency = kickTuning + (145 + aggression * 50) * Math.exp(-t * (variant === 1 ? 30 : 48));
      kickPhase += TWO_PI * frequency / RATE;
      const body = Math.sin(kickPhase) + (variant === 5 ? 0.28 * Math.sin(kickPhase * 2) : 0);
      value = body * Math.exp(-t * kickDecay) * (0.75 + aggression * 0.2)
        + rand() * kickClick * Math.exp(-t * 160);
    } else if (id === 'snare') {
      const n = rand();
      const high = n - highpassPrevious * [0.8, 0.91, 0.48, 0.97, 0.72, 0.62][variant];
      highpassPrevious = n;
      const pitched = Math.sin(TWO_PI * snareTone * t);
      value = (high * [0.49, 0.4, 0.53, 0.6, 0.37, 0.67][variant]
        + pitched * [0.18, 0.09, 0.26, 0.26, 0.16, 0.2][variant])
        * Math.exp(-t * snareDecay) * (0.88 + aggression * 0.14);
      if (variant === 5) value = Math.tanh(value * 3) * 0.7;
    } else if (id === 'hat' || id === 'openHat') {
      const n = rand();
      const filter = [0.18, 0.32, 0.10, 0.10, 0.43, 0.05][variant];
      lowpassPrevious += (n - lowpassPrevious) * filter;
      const high = n - lowpassPrevious;
      const speed = id === 'hat' ? [56, 27, 140, 46, 47, 69][variant]
        : [12, 5.8, 24, 8.5, 9, 10][variant];
      const ring = variant === 3 ? Math.sin(TWO_PI * 3200 * t) * 0.65 : 1;
      value = high * ring * (id === 'hat' ? 0.25 : 0.28) * Math.exp(-t * speed);
      if (variant === 4) value *= 0.57;
    } else if (id === 'bass') {
      const fadeIn = Math.min(1, t / 0.006);
      const fadeOut = Math.min(1, (lengthSeconds - t) / 0.028);
      let envelope = Math.max(0, fadeIn * fadeOut) * (0.76 + 0.24 * Math.exp(-t * 1.5));
      if (variant === 4) envelope *= Math.exp(-t * 10);
      const a = Math.sin(bassStep * i);
      const b = Math.sin(bassStep * 2 * i);
      let signal;
      if (variant === 0) signal = a * 0.9 + b * 0.11;
      else if (variant === 1) signal = a;
      else if (variant === 2) signal = a * 0.7 + b * 0.52 + Math.sin(bassStep * 3 * i) * 0.3;
      else if (variant === 3) signal = a * 0.48 + Math.sin(bassStep * 1.012 * i) * 0.48 + b * 0.2;
      else if (variant === 4) signal = a * 0.92 + b * 0.1;
      else signal = Math.tanh(a * 4) + b * 0.3;
      const drive = variant === 1 ? 0.83 : variant === 2 ? 4.5 : variant === 5 ? 5 : 1.3 + aggression * 2.2;
      value = Math.tanh(signal * drive) * envelope * (0.52 + aggression * 0.12);
    } else if (id === 'bell') {
      const first = variant === 1 ? Math.sin(bellA * i) : Math.sin(bellA * i) >= 0 ? 1 : -1;
      const second = variant === 1 ? Math.sin(bellB * i) : Math.sin(bellB * i) >= 0 ? 1 : -1;
      const ring = variant === 5 ? Math.sin(TWO_PI * 35 * t) : 1;
      value = (first * 0.22 + second * [0.14, 0.09, 0.21, 0.12, 0.15, 0.19][variant])
        * ring * Math.exp(-t * [20, 8, 9, 39, 6.5, 18][variant]);
    } else if (id === 'impact') {
      const frequency = (variant === 1 ? 28 : 35) + (variant === 1 ? 65 : 90) * Math.exp(-t * 7);
      impactPhase += TWO_PI * frequency / RATE;
      const filter = variant === 4 ? 0.26 : variant === 5 ? 0.015 : 0.035;
      lowpassPrevious += (rand() - lowpassPrevious) * filter;
      const fade = variant === 2 ? Math.sin(Math.PI * u / 2) : Math.exp(-t * 3);
      value = lowpassPrevious * fade * (variant === 4 ? 1.3 : 0.7)
        + Math.sin(impactPhase) * Math.exp(-t * (variant === 3 ? 14 : 5)) * 0.45;
    }
    wave[i] = value * Math.min(1, (size - 1 - i) / 100);
  }
  return wave;
}

function createEvents(preset, config, frames, bpm) {
  const events = [];
  if (config.mode === 'timeline') {
    const timeline = normalizeTimeline(config.timelineEvents || []);
    for (const clip of timeline) {
      if (config.trackMutes?.[clip.track]) continue;
      const frame = Math.round(clip.time * RATE);
      if (frame < 0 || frame >= frames) continue;
      events.push({
        id: clip.track, soundId: clip.soundId, frame,
        note: clip.note, duration: clip.steps * (60 / bpm / 4) * 0.86,
        volume: clip.volume
      });
    }
    return events.sort((a, b) => a.frame - b.frame);
  }
  const barDuration = 240 / bpm;
  const totalBars = Math.ceil(frames / RATE / barDuration);
  const offset = clamp(Number(config.beatOffset) || 0, 0, 0.75);
  const kit = { ...kitForPreset(config.preset), ...config.kit };
  const add = (id, time, note = 0, duration = 0.2) => {
    if (config.trackMutes?.[id]) return;
    const frame = Math.round(time * RATE);
    if (frame >= 0 && frame < frames) {
      events.push({ id, soundId: resolveSound(id, kit[id]).id, frame, note, duration });
    }
  };
  if (config.mode === 'manual') {
    const pattern = normalizePattern(config.manualPattern);
    for (let bar = 0; bar < totalBars; bar++) {
      const start = offset + bar * barDuration;
      if (start >= frames / RATE) break;
      for (const track of ['kick', 'snare', 'hat', 'openHat', 'bass', 'bell', 'impact']) {
        if (track === 'bell' && config.cowbell === false) continue;
        if (track === 'impact' && config.effects === false) continue;
        for (const entry of pattern[track]) {
          const [step, note, length] = Array.isArray(entry) ? entry : [entry, 0, 1];
          const duration = track === 'bass' ? length * (60 / bpm / 4) * 0.86 : 0.2;
          add(track, start + stepTime(step, bpm, preset.swing), note, duration);
        }
      }
    }
    events.sort((a, b) => a.frame - b.frame);
    return events;
  }
  for (let bar = 0; bar < totalBars; bar++) {
    const start = offset + bar * barDuration;
    if (start >= frames / RATE) break;
    const intro = bar < 2 && totalBars > 4;
    const breakdown = bar % 16 >= 14 && totalBars > 20;
    const active = !intro && !breakdown;
    const variant = bar % 8 === 7;
    if (bar % 8 === 2 && config.effects) add('impact', start);
    for (const step of preset.kick) {
      if (!active && step !== 0) continue;
      add('kick', start + stepTime(step, bpm, preset.swing));
    }
    for (const step of preset.snare) {
      if (!active && step !== 12) continue;
      add('snare', start + stepTime(step, bpm, preset.swing));
    }
    for (const step of preset.hat) {
      if ((intro || breakdown) && step % 4 !== 0) continue;
      add('hat', start + stepTime(step, bpm, preset.swing));
    }
    if (active) {
      for (const step of preset.openHat) {
        add('openHat', start + stepTime(step, bpm, preset.swing));
      }
      if (variant) {
        for (const step of [12, 13, 14, 15]) {
          add('snare', start + stepTime(step, bpm, preset.swing));
        }
      }
    }
    if (!intro) {
      for (const [step, note, steps] of preset.bass) {
        add('bass', start + stepTime(step, bpm, preset.swing), note, steps * (60 / bpm / 4) * 0.86);
      }
    }
    if (config.cowbell && !breakdown) {
      for (const [step, note] of preset.bell) {
        if (intro && step % 4 !== 0) continue;
        add('bell', start + stepTime(step, bpm, preset.swing), note);
      }
    }
  }
  events.sort((a, b) => a.frame - b.frame);
  return events;
}

function writeWavHeader(frameCount) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  const dataBytes = frameCount * 2 * 2;
  ascii(0, 'RIFF'); view.setUint32(4, dataBytes + 36, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 4, true); view.setUint16(32, 4, true);
  view.setUint16(34, 16, true); ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

function eventGain(id, config) {
  const aggression = clamp(Number(config.aggression) || 0, 0, 100) / 100;
  const bass = clamp(Number(config.bass) || 0, 0, 100) / 100;
  const trackVolume = clamp(Number(config.trackGains?.[id] ?? 100), 0, 150) / 100;
  let gain = id === 'bass' ? 0.45 + bass * 0.53
    : id === 'bell' ? 0.31 + aggression * 0.13
    : id === 'impact' ? 0.6 : 0.56 + aggression * 0.3;
  return gain * trackVolume;
}

function mixSource(left, right, begin, source, config, bpm, sourceBpm) {
  if (!config.keepOriginal) return;
  const inputLeft = source.getChannelData(0);
  const inputRight = source.numberOfChannels > 1 ? source.getChannelData(1) : inputLeft;
  const scale = (bpm / sourceBpm) * source.sampleRate / RATE;
  let index = begin * scale;
  const gain = 0.48;
  for (let i = 0; i < left.length; i++, index += scale) {
    const j = Math.floor(index);
    if (j >= inputLeft.length - 1) break;
    const f = index - j;
    left[i] = (inputLeft[j] + (inputLeft[j + 1] - inputLeft[j]) * f) * gain;
    right[i] = (inputRight[j] + (inputRight[j + 1] - inputRight[j]) * f) * gain;
  }
}

function encodeChunk(left, right, gainState = { value: 1 }) {
  // Int16Array is little-endian on the supported Windows/macOS/Linux targets.
  const pcm = new Int16Array(left.length * 2);
  let ceiling = gainState.value;
  for (let i = 0; i < left.length; i++) {
    // Smooth peak control maintains continuity across chunk boundaries.
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const target = Math.min(1, 0.94 / Math.max(0.001, peak));
    ceiling = target < ceiling ? target : Math.min(1, ceiling + 0.00003);
    const l = Math.max(-1, Math.min(1, left[i] * ceiling));
    const r = Math.max(-1, Math.min(1, right[i] * ceiling));
    pcm[2 * i] = Math.round(l * (l < 0 ? 32768 : 32767));
    pcm[2 * i + 1] = Math.round(r * (r < 0 ? 32768 : 32767));
  }
  gainState.value = ceiling;
  return pcm.buffer;
}

function abortIfRequested(signal) {
  if (signal?.aborted) {
    const error = new Error('Render cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * Offline PCM renderer, suitable for long tracks. The maximum duration is
 * explicit (15 minutes) and it never silently truncates the source.
 * Progress reports *rendered frames*, not fake timers.
 */
export async function renderRemix(input, config, onProgress = () => {}, signal) {
  const preset = PRESETS[config.preset] || PRESETS.drift;
  const sourceBpm = clamp(Number(config.sourceBpm) || preset.bpm, 50, 240);
  const bpm = clamp(Number(config.bpm) || preset.bpm, 60, 210);
  const rate = bpm / sourceBpm;
  const duration = input.duration / rate;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source audio is empty or invalid.');
  if (duration > MAX_RENDER_SECONDS) {
    throw new Error('Output is ' + Math.ceil(duration / 60) + ' minutes. This version supports up to 15 minutes. Shorten the track or increase target BPM.');
  }
  if (input.numberOfChannels < 1 || input.numberOfChannels > 2) {
    throw new Error('Only mono or stereo source files are supported.');
  }
  const totalFrames = Math.floor(duration * RATE);
  const events = createEvents(preset, config, totalFrames, bpm);
  // Cache each one-shot once. Number of Web Audio nodes during render: zero.
  const cache = new Map();
  for (const event of events) {
    const key = [event.soundId, event.note, event.duration.toFixed(4)].join('/');
    if (!cache.has(key)) cache.set(key, synthesize(event.soundId, config, event.note, event.duration));
    event.sample = cache.get(key);
    event.gain = eventGain(event.id, config) * ((event.volume ?? 100) / 100);
  }

  const parts = [writeWavHeader(totalFrames)];
  let cursor = 0;
  let head = 0;
  const gainState = { value: 1 }; // Keep limiter gain continuous across chunk boundaries.
  onProgress(0);
  for (let begin = 0; begin < totalFrames; begin += CHUNK_FRAMES) {
    abortIfRequested(signal);
    const end = Math.min(begin + CHUNK_FRAMES, totalFrames);
    const left = new Float32Array(end - begin);
    const right = new Float32Array(end - begin);
    mixSource(left, right, begin, input, config, bpm, sourceBpm);

    while (head < events.length && events[head].frame + events[head].sample.length <= begin) head++;
    for (let j = head; j < events.length && events[j].frame < end; j++) {
      const event = events[j];
      const first = Math.max(begin, event.frame);
      const last = Math.min(end, event.frame + event.sample.length);
      const gain = event.gain;
      for (let frame = first; frame < last; frame++) {
        const value = event.sample[frame - event.frame] * gain;
        left[frame - begin] += value;
        right[frame - begin] += value;
      }
    }
    parts.push(encodeChunk(left, right, gainState));
    cursor = end;
    onProgress(Math.round(cursor / totalFrames * 100));
    // Yield the main thread so Electron can draw progress and handle Cancel.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  abortIfRequested(signal);
  const blob = new Blob(parts, { type: 'audio/wav' });
  return { blob, duration: totalFrames / RATE, bpm, hits: events.length, truncated: false };
}

// The exact same PCM synth is used by the live timeline player and offline renderer.
export function synthesizeInstrument(soundId, config = {}, note = 0, duration = 0.2) {
  if (!SOUND_INDEX[soundId]) throw new Error('Unknown sound: ' + soundId);
  return synthesize(soundId, config, note, duration);
}

export async function previewInstrument(id, key = 'A') {
  const config = { aggression: 78, bass: 85, key };
  const sound = SOUND_INDEX[id];
  if (!sound) throw new Error('Unknown sound: ' + id);
  const signal = synthesize(id, config, 0, sound.family === 'bass' ? 0.6 : 0.2);
  const count = RATE;
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const start = Math.floor(0.12 * RATE);
  const gain = eventGain(sound.family, config);
  for (let i = 0; i < signal.length && i + start < count; i++) {
    left[i + start] = signal[i] * gain;
    right[i + start] = signal[i] * gain;
  }
  return new Blob([writeWavHeader(count), encodeChunk(left, right)], { type: 'audio/wav' });
}
