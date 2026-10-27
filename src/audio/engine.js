import { PRESETS, TONICS, stepTime } from './presets.js';
import { audioBufferToWav } from './wav.js';

const RATE = 44100;
const LIMIT_SECONDS = 240;
const midiHz = note => 440 * Math.pow(2, (note - 69) / 12);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

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

function noiseBuffer(ctx) {
  const buffer = ctx.createBuffer(1, Math.floor(RATE * 1.4), RATE);
  const samples = buffer.getChannelData(0);
  let state = 146627;
  for (let i = 0; i < samples.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    samples[i] = (state / 2147483648) * 0.6;
  }
  return buffer;
}

function gainEnv(ctx, destination, time, attack, hold, release, peak) {
  const node = ctx.createGain();
  node.gain.setValueAtTime(0.0001, time);
  node.gain.linearRampToValueAtTime(peak, time + attack);
  node.gain.setValueAtTime(peak, time + attack + hold);
  node.gain.exponentialRampToValueAtTime(0.0001, time + attack + hold + release);
  node.connect(destination);
  return node;
}
function sine(ctx, destination, time, duration, fromHz, toHz, peak, type = 'sine') {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(10, toHz), time + Math.min(duration * 0.75, 0.3));
  const g = gainEnv(ctx, destination, time, 0.003, 0, Math.max(0.01, duration - 0.003), peak);
  osc.connect(g);
  osc.start(time);
  osc.stop(time + duration + 0.02);
}

function burst(ctx, noise, destination, time, duration, cutoff, peak, highpass = true) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = highpass ? 'highpass' : 'lowpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 0.55;
  source.connect(filter);
  filter.connect(gainEnv(ctx, destination, time, 0.001, 0, duration - 0.001, peak));
  source.start(time, 0, Math.min(duration + 0.01, noise.duration));
  source.stop(time + duration + 0.01);
}

function distortion(ctx, amount) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(4096);
  const k = 1 + amount * 35;
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

function buildMixer(ctx, config) {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -15;
  compressor.knee.value = 5;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  const ceiling = ctx.createGain();
  ceiling.gain.value = 0.83;
  compressor.connect(ceiling);
  ceiling.connect(ctx.destination);
  const source = ctx.createGain();
  const drums = ctx.createGain();
  const bass = ctx.createGain();
  const bell = ctx.createGain();
  const fx = ctx.createGain();
  source.gain.value = config.keepOriginal ? 0.54 : 0;
  drums.gain.value = 0.55 + config.aggression / 230;
  bass.gain.value = 0.33 + config.bass / 200;
  bell.gain.value = config.cowbell ? 0.2 + config.aggression / 450 : 0;
  fx.gain.value = 0.32;
  source.connect(compressor);
  drums.connect(compressor);
  const saturation = distortion(ctx, config.aggression / 175);
  bass.connect(saturation);
  saturation.connect(compressor);
  bell.connect(compressor);
  fx.connect(compressor);
  return { source, drums, bass, bell, fx };
}

function playVoice(ctx, noise, id, time, bus, config, semitone = 0, duration = 0.2) {
  const intensity = clamp(config.aggression / 100, 0, 1);
  const tonic = TONICS[config.key] ?? TONICS.A;
  if (id === 'kick') {
    sine(ctx, bus, time, 0.25, 150 + intensity * 55, 41, 0.75 + intensity * 0.2);
    burst(ctx, noise, bus, time, 0.035, 3600, 0.16);
  } else if (id === 'snare') {
    burst(ctx, noise, bus, time, 0.17, 1300, 0.55 + intensity * 0.1);
    sine(ctx, bus, time, 0.11, 215, 160, 0.26, 'triangle');
  } else if (id === 'hat' || id === 'openHat') {
    burst(ctx, noise, bus, time, id === 'hat' ? 0.065 : 0.34, 6700, id === 'hat' ? 0.2 : 0.23);
  } else if (id === 'bass') {
    const hz = midiHz(tonic - 12 + semitone);
    const length = clamp(duration, 0.07, 1.9);
    sine(ctx, bus, time, length, hz * 1.025, hz, 0.9, 'sine');
    sine(ctx, bus, time, length * 0.86, hz * 2.01, hz * 2, 0.12, 'triangle');
  } else if (id === 'bell') {
    const hz = midiHz(tonic + 24 + semitone);
    sine(ctx, bus, time, 0.13, hz, hz, 0.25, 'square');
    sine(ctx, bus, time, 0.17, hz * 1.47, hz * 1.47, 0.15, 'square');
  } else if (id === 'impact') {
    burst(ctx, noise, bus, time, 0.8, 2900, 0.56, false);
    sine(ctx, bus, time, 0.8, 110, 36, 0.7);
  }
}

export async function renderRemix(input, config) {
  const preset = PRESETS[config.preset] || PRESETS.drift;
  const sourceBpm = clamp(Number(config.sourceBpm) || preset.bpm, 50, 240);
  const bpm = clamp(Number(config.bpm) || preset.bpm, 60, 210);
  const rate = bpm / sourceBpm;
  const trimmedLength = Math.min(LIMIT_SECONDS, input.duration / rate);
  const length = Math.ceil((trimmedLength + 0.6) * RATE);
  const ctx = new OfflineAudioContext(2, length, RATE);
  const noise = noiseBuffer(ctx);
  const mixer = buildMixer(ctx, config);
  const music = ctx.createBufferSource();
  music.buffer = input;
  music.playbackRate.value = rate;
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 90;
  const soften = ctx.createBiquadFilter();
  soften.type = 'highshelf';
  soften.frequency.value = 7200;
  soften.gain.value = -2.4;
  music.connect(highpass);
  highpass.connect(soften);
  soften.connect(mixer.source);
  music.start(0);
  music.stop(trimmedLength);

  const barDuration = 240 / bpm;
  const bars = Math.ceil(trimmedLength / barDuration);
  const maxTime = trimmedLength - 0.02;
  const offset = clamp(Number(config.beatOffset) || 0, 0, 0.75);
  let hits = 0;
  function hit(id, time, bus, semitone = 0, duration = 0.2) {
    if (time < 0 || time > maxTime) return;
    playVoice(ctx, noise, id, time, bus, config, semitone, duration);
    hits++;
  }

  for (let bar = 0; bar < bars; bar++) {
    const start = offset + bar * barDuration;
    if (start > maxTime) break;
    const intro = bar < 2 && bars > 4;
    const breakdown = bar % 16 >= 14 && bars > 20;
    const active = !intro && !breakdown;
    const variant = bar % 8 === 7;
    if (bar % 8 === 2 && config.effects) hit('impact', start, mixer.fx);
    for (const step of preset.kick) {
      if (!active && step !== 0) continue;
      hit('kick', start + stepTime(step, bpm, preset.swing), mixer.drums);
    }
    for (const step of preset.snare) {
      if (!active && step !== 12) continue;
      hit('snare', start + stepTime(step, bpm, preset.swing), mixer.drums);
    }
    for (const step of preset.hat) {
      if (intro && step % 4) continue;
      if (breakdown && step % 4) continue;
      hit('hat', start + stepTime(step, bpm, preset.swing), mixer.drums);
    }
    if (active) {
      for (const step of preset.openHat) {
        hit('openHat', start + stepTime(step, bpm, preset.swing), mixer.drums);
      }
      if (variant) {
        for (const step of [12, 13, 14, 15]) {
          hit('snare', start + stepTime(step, bpm, preset.swing), mixer.drums);
        }
      }
    }
    if (!intro) {
      for (const [step, note, steps] of preset.bass) {
        const duration = (60 / bpm / 4) * steps * 0.86;
        hit('bass', start + stepTime(step, bpm, preset.swing), mixer.bass, note, duration);
      }
    }
    if (config.cowbell && !breakdown) {
      for (const [step, note] of preset.bell) {
        if (intro && step % 4) continue;
        hit('bell', start + stepTime(step, bpm, preset.swing), mixer.bell, note);
      }
    }
  }
  const rendered = await ctx.startRendering();
  return { blob: audioBufferToWav(rendered), duration: trimmedLength, bpm, hits, truncated: input.duration / rate > LIMIT_SECONDS };
}

export async function previewInstrument(id, key = 'A') {
  const ctx = new OfflineAudioContext(2, RATE * 2, RATE);
  const noise = noiseBuffer(ctx);
  const bus = buildMixer(ctx, { keepOriginal: false, aggression: 78, bass: 85, cowbell: true });
  const destination = id === 'bass' ? bus.bass : id === 'bell' ? bus.bell : id === 'impact' ? bus.fx : bus.drums;
  playVoice(ctx, noise, id, 0.12, destination, { aggression: 78, key }, 0, 0.6);
  const rendered = await ctx.startRendering();
  return audioBufferToWav(rendered);
}
