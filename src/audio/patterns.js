import { PRESETS } from './presets.js';
import { DEFAULT_KIT, TRACKS, resolveSound } from './library.js';

export const STEP_COUNT = 16;
export const TONAL_TRACKS = new Set(['bass', 'bell']);
export const DEFAULT_TRACK_GAINS = Object.fromEntries(TRACKS.map(track => [track.id, 100]));
export const DEFAULT_TRACK_MUTES = Object.fromEntries(TRACKS.map(track => [track.id, false]));

export function patternFromPreset(preset) {
  const selected = typeof preset === 'string' ? PRESETS[preset] || PRESETS.drift : preset;
  return {
    kick: [...selected.kick],
    snare: [...selected.snare],
    hat: [...selected.hat],
    openHat: [...selected.openHat],
    bass: selected.bass.map(([step, note, length]) => [step, note, length]),
    bell: selected.bell.map(([step, note]) => [step, note, 1]),
    impact: [0]
  };
}
export function emptyPattern() {
  return Object.fromEntries(TRACKS.map(track => [track.id, []]));
}

export function toggleStep(pattern, track, step) {
  if (!TRACKS.some(t => t.id === track) || !Number.isInteger(step) || step < 0 || step >= STEP_COUNT) return pattern;
  const events = pattern[track] || [];
  const exists = events.some(item => (Array.isArray(item) ? item[0] : item) === step);
  const next = exists
    ? events.filter(item => (Array.isArray(item) ? item[0] : item) !== step)
    : [...events, TONAL_TRACKS.has(track) ? [step, 0, track === 'bass' ? 2 : 1] : step];
  return { ...pattern, [track]: next.sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b)) };
}

export function setStepNote(pattern, track, step, note) {
  if (!TONAL_TRACKS.has(track) || !Number.isInteger(step) || step < 0 || step >= STEP_COUNT) return pattern;
  if (!Number.isInteger(note) || note < -12 || note > 12) return pattern;
  return {
    ...pattern,
    [track]: (pattern[track] || []).map(item => item[0] === step ? [step, note, item[2] || 1] : item)
  };
}
export function setStepLength(pattern, step, length) {
  if (!Number.isInteger(length) || length < 1 || length > 8) return pattern;
  return { ...pattern, bass: (pattern.bass || []).map(item => item[0] === step ? [step, item[1], length] : item) };
}

export function normalizePattern(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid pattern.');
  const next = {};
  for (const { id } of TRACKS) {
    const events = raw[id];
    if (!Array.isArray(events) || events.length > STEP_COUNT) throw new Error('Invalid ' + id + ' sequence.');
    const seen = new Set();
    next[id] = [];
    for (const event of events) {
      const item = Array.isArray(event) ? event : [event, 0, id === 'bass' ? 2 : 1];
      const [step, note = 0, length = 1] = item;
      if (!Number.isInteger(step) || step < 0 || step >= STEP_COUNT || seen.has(step)) {
        throw new Error('Invalid or duplicate steps in ' + id + '.');
      }
      if (!Number.isInteger(note) || note < -12 || note > 12 || !Number.isInteger(length) || length < 1 || length > 8) {
        throw new Error('Invalid note or length in ' + id + '.');
      }
      seen.add(step);
      next[id].push(TONAL_TRACKS.has(id) ? [step, note, length] : step);
    }
    next[id].sort((a, b) => (Array.isArray(a) ? a[0] : a) - (Array.isArray(b) ? b[0] : b));
  }
  return next;
}
export function normalizeKit(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_KIT };
  return Object.fromEntries(TRACKS.map(track => [track.id, resolveSound(track.id, raw[track.id]).id]));
}
export function normalizeTrackValues(raw, fallback, min, max, numeric) {
  return Object.fromEntries(TRACKS.map(track => {
    const value = raw?.[track.id];
    if (numeric) return [track.id, Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback[track.id]];
    return [track.id, typeof value === 'boolean' ? value : fallback[track.id]];
  }));
}
