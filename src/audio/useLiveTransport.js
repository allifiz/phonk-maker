import { useCallback, useEffect, useRef, useState } from 'react';
import { synthesizeInstrument } from './engine.js';

const LOOKAHEAD = 0.14; // 140ms ahead protects against UI/layout work interrupting drums
const TICK_MS = 35;
const SYNTH_RATE = 44100;

/**
 * Shared transport clock: music and one-shot instruments use the same AudioContext.
 * Timeline coordinates are OUTPUT seconds. Source rate follows target/source BPM.
 * Only imminent events are scheduled, so multi-minute projects stay responsive.
 */
export function useLiveTransport({ song, config, events, duration, onError, onStart }) {
  const audioRef = useRef(null);
  const mixerRef = useRef(null);
  const musicRef = useRef(null);
  const musicGainRef = useRef(null);
  const voicesRef = useRef(new Map());
  const sampleCacheRef = useRef(new Map());
  const timerRef = useRef(null);
  const playingRef = useRef(false);
  const commandRef = useRef(0); // Only the latest play/seek request may start audio.
  const clockRef = useRef({ contextStart: 0, offset: 0 });
  const positionRef = useRef(0);
  const eventsRef = useRef(events);
  const configRef = useRef(config);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const durationRef = useRef(duration);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  eventsRef.current = events;
  configRef.current = config;
  onErrorRef.current = onError;
  onStartRef.current = onStart;
  durationRef.current = duration;

  const getPosition = useCallback(() => {
    const ctx = audioRef.current;
    if (!playingRef.current || !ctx) return positionRef.current;
    const { contextStart, offset } = clockRef.current;
    return Math.min(durationRef.current, Math.max(0, offset + Math.max(0, ctx.currentTime - contextStart)));
  }, []);

  const clearVoices = useCallback(() => {
    for (const { node } of voicesRef.current.values()) {
      try { node.stop(); } catch { /* already finished */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    voicesRef.current.clear();
  }, []);

  const stopMusic = useCallback(() => {
    if (musicRef.current) {
      try { musicRef.current.stop(); } catch { /* already stopped */ }
      try { musicRef.current.disconnect(); } catch { /* ignore */ }
      musicRef.current = null;
    }
    if (musicGainRef.current) {
      try { musicGainRef.current.disconnect(); } catch { /* ignore */ }
      musicGainRef.current = null;
    }
  }, []);

  const pause = useCallback(() => {
    commandRef.current++;
    const value = getPosition();
    playingRef.current = false;
    positionRef.current = value;
    setPosition(value);
    setPlaying(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopMusic();
    clearVoices();
  }, [getPosition, stopMusic, clearVoices]);

  const ensureAudio = useCallback(async () => {
    if (!audioRef.current) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('This environment does not support Web Audio.');
      const ctx = new Ctor();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 8;
      compressor.ratio.value = 10;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.16;
      const ceiling = ctx.createGain();
      ceiling.gain.value = 0.8;
      compressor.connect(ceiling);
      ceiling.connect(ctx.destination);
      audioRef.current = ctx;
      mixerRef.current = compressor;
    }
    const ctx = audioRef.current;
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }, []);

  const getSampleBuffer = useCallback((ctx, event) => {
    const cfg = configRef.current;
    const beat = 60 / Math.max(60, cfg.bpm) / 4;
    const duration = (event.steps || 2) * beat * 0.86;
    const key = [event.soundId, event.note, duration.toFixed(4), cfg.key, cfg.aggression].join('/');
    const cache = sampleCacheRef.current;
    if (cache.has(key)) return cache.get(key);
    const pcm = synthesizeInstrument(event.soundId, cfg, event.note, duration);
    const buffer = ctx.createBuffer(1, pcm.length, SYNTH_RATE);
    buffer.copyToChannel(pcm, 0);
    if (cache.size > 96) cache.clear();
    cache.set(key, buffer);
    return buffer;
  }, []);

  const voiceGain = useCallback(event => {
    const cfg = configRef.current;
    const aggression = Math.max(0, Math.min(100, cfg.aggression || 0)) / 100;
    const bass = Math.max(0, Math.min(100, cfg.bass || 0)) / 100;
    const base = event.track === 'bass' ? 0.45 + bass * 0.53
      : event.track === 'bell' ? 0.31 + aggression * 0.13
      : event.track === 'impact' ? 0.6 : 0.56 + aggression * 0.3;
    return base * Math.max(0, Math.min(150, cfg.trackGains?.[event.track] ?? 100)) / 100
      * Math.max(0, Math.min(150, event.volume ?? 100)) / 100;
  }, []);

  const fireVoice = useCallback((ctx, event, startWhen, offsetSeconds = 0, store = true) => {
    if (configRef.current.trackMutes?.[event.track]) return;
    const buffer = getSampleBuffer(ctx, event);
    if (offsetSeconds >= buffer.duration) return;
    const node = ctx.createBufferSource();
    const volume = ctx.createGain();
    volume.gain.value = voiceGain(event);
    node.buffer = buffer;
    node.connect(volume);
    volume.connect(mixerRef.current);
    node.start(Math.max(ctx.currentTime, startWhen), Math.max(0, offsetSeconds));
    const identifier = event.id;
    if (store) voicesRef.current.set(identifier, { node, volume, event, startWhen });
    node.onended = () => {
      const previous = voicesRef.current.get(identifier);
      if (previous?.node === node) voicesRef.current.delete(identifier);
      node.disconnect();
      volume.disconnect();
    };
    return node;
  }, [getSampleBuffer, voiceGain]);

  const tick = useCallback(() => {
    const ctx = audioRef.current;
    if (!ctx || !playingRef.current) return;
    const now = getPosition();
    setPosition(now);
    if (now >= durationRef.current - 0.002) {
      pause();
      return;
    }
    const end = Math.min(durationRef.current, now + LOOKAHEAD);
    const { contextStart, offset } = clockRef.current;
    for (const event of eventsRef.current) {
      if (event.time < now - 0.01 || event.time >= end) continue;
      if (voicesRef.current.has(event.id)) continue;
      const startWhen = contextStart + (event.time - offset);
      const late = Math.max(0, ctx.currentTime - startWhen);
      fireVoice(ctx, event, startWhen, late, true);
    }
  }, [fireVoice, getPosition, pause]);

  const startAt = useCallback(async (value, command) => {
    if (!song?.buffer) return;
    const ctx = await ensureAudio();
    if (command !== commandRef.current || ctx.state === 'closed') return;
    const safe = Math.max(0, Math.min(Math.max(0, durationRef.current - 0.01), value));
    stopMusic();
    clearVoices();
    const when = ctx.currentTime + 0.045;
    clockRef.current = { contextStart: when, offset: safe };
    positionRef.current = safe;
    const ratio = Math.max(60, Math.min(210, configRef.current.bpm || 150)) / Math.max(50, Math.min(240, configRef.current.sourceBpm || 150));
    const node = ctx.createBufferSource();
    node.buffer = song.buffer;
    node.playbackRate.value = ratio;
    const gain = ctx.createGain();
    gain.gain.value = configRef.current.keepOriginal ? 0.48 : 0;
    node.connect(gain);
    gain.connect(mixerRef.current);
    musicGainRef.current = gain;
    node.start(when, Math.min(song.buffer.duration - 0.01, safe * ratio));
    musicRef.current = node;
    playingRef.current = true;
    setPlaying(true);
    setPosition(safe);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(tick, TICK_MS);
    tick();
  }, [song?.buffer, ensureAudio, clearVoices, stopMusic, tick]);

  const play = useCallback(async () => {
    try {
      if (playingRef.current) { pause(); return; }
      onStartRef.current?.();
      await startAt(positionRef.current >= durationRef.current - 0.1 ? 0 : positionRef.current, ++commandRef.current);
    } catch (error) {
      onErrorRef.current?.(error?.message || 'Could not start live playback.');
      pause();
    }
  }, [pause, startAt]);

  const seek = useCallback(async next => {
    const desired = Math.max(0, Math.min(durationRef.current, Number(next) || 0));
    if (playingRef.current) {
      pause();
      const token = ++commandRef.current;
      try { await startAt(desired, token); } catch (error) { onErrorRef.current?.(error?.message || 'Seek failed.'); }
    } else {
      commandRef.current++;
      positionRef.current = desired;
      setPosition(desired);
    }
  }, [pause, startAt]);

  // HIT NOW audition uses the same exact sound as the exported event.
  const trigger = useCallback(async event => {
    try {
      const ctx = await ensureAudio();
      const now = ctx.currentTime;
      // A newly placed event should sound immediately and only once.
      // Tracking it prevents the 140ms scheduler from duplicating the hit.
      fireVoice(ctx, event, now + 0.002, 0, playingRef.current);
    } catch (error) {
      onErrorRef.current?.(error?.message || 'Could not audition the sound.');
    }
  }, [ensureAudio, fireVoice]);

  // Cancel previously scheduled notes if the user moves/deletes their event.
  useEffect(() => {
    const valid = new Map(events.map(event => [event.id, event]));
    for (const [id, voice] of voicesRef.current) {
      const next = valid.get(id);
      if (!next || next.time !== voice.event.time || next.soundId !== voice.event.soundId
          || next.track !== voice.event.track || next.note !== voice.event.note
          || next.steps !== voice.event.steps || next.volume !== voice.event.volume) {
        try { voice.node.stop(); } catch {}
        voicesRef.current.delete(id);
      }
    }
  }, [events]);

  // Changes to active track levels are immediately audible without restarting the source.
  useEffect(() => {
    const ctx = audioRef.current;
    for (const [id, voice] of voicesRef.current) {
      if (config.trackMutes?.[voice.event.track]) {
        try { voice.node.stop(); } catch { /* already finished */ }
        voicesRef.current.delete(id);
      } else if (ctx) {
        voice.volume.gain.setTargetAtTime(voiceGain(voice.event), ctx.currentTime, 0.012);
      }
    }
  }, [config.trackGains, config.trackMutes, config.bass, config.aggression, voiceGain]);

  useEffect(() => {
    sampleCacheRef.current.clear();
  }, [config.aggression, config.key, config.bpm]);

  // Preserve the playhead but stop audio if tempo/source changes.
  useEffect(() => {
    if (playingRef.current) pause();
  }, [song?.buffer, config.bpm, config.sourceBpm, pause]);

  useEffect(() => () => {
    commandRef.current++;
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusic();
    clearVoices();
    const ctx = audioRef.current;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
  }, [stopMusic, clearVoices]);

  return { position, playing, play, pause, seek, getPosition, trigger };
}
