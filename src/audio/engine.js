import { PRESETS, TONICS, stepTime } from './presets.js';

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

function synthesize(id, config, note = 0, duration = 0.2) {
  const aggression = clamp(Number(config.aggression) || 0, 0, 100) / 100;
  const tonic = TONICS[config.key] ?? TONICS.A;
  const lengthSeconds = {
    kick: 0.29, snare: 0.22, hat: 0.09, openHat: 0.38,
    bass: clamp(duration + 0.04, 0.10, 2.0), bell: 0.22, impact: 0.85
  }[id];
  if (!lengthSeconds) throw new Error('Unknown sound: ' + id);
  const size = Math.ceil(lengthSeconds * RATE);
  const wave = new Float32Array(size);
  const rand = noiseGenerator(id.length * 901 + note * 31 + 4181);
  const bassHz = midiHz(tonic - 12 + note);
  const bellHz = midiHz(tonic + 24 + note);
  const bellA = TWO_PI * bellHz / RATE;
  const bellB = TWO_PI * bellHz * 1.47 / RATE;
  const bassStep = TWO_PI * bassHz / RATE;
  let kickPhase = 0;
  let impactPhase = 0;
  let highpassPrevious = 0;
  let lowpassPrevious = 0;
  for (let i = 0; i < size; i++) {
    const t = i / RATE;
    const u = i / size;
    let value = 0;
    if (id === 'kick') {
      const frequency = 43 + (175 + aggression * 50) * Math.exp(-t * 45);
      kickPhase += TWO_PI * frequency / RATE;
      value = Math.sin(kickPhase) * Math.exp(-t * 18) * (0.75 + aggression * 0.2)
        + rand() * 0.2 * Math.exp(-t * 140);
    } else if (id === 'snare') {
      const n = rand();
      const high = n - highpassPrevious * 0.8;
      highpassPrevious = n;
      value = (high * 0.49 + Math.sin(TWO_PI * 178 * t) * 0.18)
        * Math.exp(-t * 19) * (0.88 + aggression * 0.14);
    } else if (id === 'hat' || id === 'openHat') {
      const n = rand();
      lowpassPrevious += (n - lowpassPrevious) * 0.18;
      const high = n - lowpassPrevious;
      value = high * (id === 'hat' ? 0.25 : 0.28)
        * Math.exp(-t * (id === 'hat' ? 56 : 12));
    } else if (id === 'bass') {
      // Short fade-in and fade-out prevent clicks where notes terminate.
      const fadeIn = Math.min(1, t / 0.006);
      const fadeOut = Math.min(1, (lengthSeconds - t) / 0.028);
      const envelope = Math.max(0, fadeIn * fadeOut) * (0.76 + 0.24 * Math.exp(-t * 1.5));
      const signal = Math.sin(bassStep * i) * 0.9 + Math.sin(bassStep * 2 * i) * 0.11;
      const drive = 1.3 + aggression * 2.2;
      value = Math.tanh(signal * drive) * envelope * (0.52 + aggression * 0.12);
    } else if (id === 'bell') {
      const first = Math.sin(bellA * i) >= 0 ? 1 : -1;
      const second = Math.sin(bellB * i) >= 0 ? 1 : -1;
      value = (first * 0.22 + second * 0.14) * Math.exp(-t * 20);
    } else if (id === 'impact') {
      const frequency = 35 + 90 * Math.exp(-t * 7);
      impactPhase += TWO_PI * frequency / RATE;
      lowpassPrevious += (rand() - lowpassPrevious) * 0.035;
      value = lowpassPrevious * Math.exp(-t * 3) * 0.7
        + Math.sin(impactPhase) * Math.exp(-t * 5) * 0.45;
    }
    // A very short fade at the endpoint prevents a sample discontinuity.
    wave[i] = value * Math.min(1, (size - 1 - i) / 100);
  }
  return wave;
}

function createEvents(preset, config, frames, bpm) {
  const events = [];
  const barDuration = 240 / bpm;
  const totalBars = Math.ceil(frames / RATE / barDuration);
  const offset = clamp(Number(config.beatOffset) || 0, 0, 0.75);
  const add = (id, time, note = 0, duration = 0.2) => {
    const frame = Math.round(time * RATE);
    if (frame >= 0 && frame < frames) {
      events.push({ id, frame, note, duration });
    }
  };
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
  if (id === 'bass') return 0.45 + bass * 0.53;
  if (id === 'bell') return 0.31 + aggression * 0.13;
  if (id === 'impact') return 0.6;
  return 0.56 + aggression * 0.3;
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
    const key = [event.id, event.note, event.duration.toFixed(4)].join('/');
    if (!cache.has(key)) cache.set(key, synthesize(event.id, config, event.note, event.duration));
    event.sample = cache.get(key);
    event.gain = eventGain(event.id, config);
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

export async function previewInstrument(id, key = 'A') {
  const config = { aggression: 78, bass: 85, key };
  const signal = synthesize(id, config, 0, id === 'bass' ? 0.6 : 0.2);
  const count = RATE;
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const start = Math.floor(0.12 * RATE);
  const gain = eventGain(id, config);
  for (let i = 0; i < signal.length && i + start < count; i++) {
    left[i + start] = signal[i] * gain;
    right[i + start] = signal[i] * gain;
  }
  return new Blob([writeWavHeader(count), encodeChunk(left, right)], { type: 'audio/wav' });
}
