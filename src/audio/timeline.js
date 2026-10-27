import { TRACKS, resolveSound } from './library.js';

const VALID_TRACKS = new Set(TRACKS.map(track => track.id));
export const MAX_TIMELINE_EVENTS = 5000;
export const MAX_TIMELINE_SECONDS = 15 * 60;

export function snapSeconds(seconds, bpm, enabled, offset = 0) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 0;
  if (!enabled) return Math.max(0, value);
  const step = 60 / Math.max(60, Math.min(210, Number(bpm) || 150)) / 4;
  const origin = Math.max(0, Number(offset) || 0);
  return Math.max(0, Math.round((value - origin) / step) * step + origin);
}

export function normalizeTimeline(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_TIMELINE_EVENTS) throw new Error('Invalid or oversized timeline.');
  const used = new Set();
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid timeline event at index ' + index);
    const id = String(item.id || '');
    const track = item.track;
    const time = item.time;
    const note = item.note ?? 0;
    const steps = item.steps ?? 2;
    const volume = item.volume ?? 100;
    const durationSeconds = item.durationSeconds ?? null;
    const pitchFx = item.pitchFx ?? 'flat';
    const pitchAmount = item.pitchAmount ?? 6;
    const echo = item.echo ?? 0;
    if (!id || id.length > 100 || used.has(id)) throw new Error('Invalid or duplicate timeline ID.');
    if (!VALID_TRACKS.has(track)) throw new Error('Invalid timeline track.');
    if (!Number.isFinite(time) || time < 0 || time > MAX_TIMELINE_SECONDS) throw new Error('Invalid event time.');
    if (!Number.isInteger(note) || note < -12 || note > 12) throw new Error('Invalid event pitch.');
    if (!Number.isInteger(steps) || steps < 1 || steps > 16) throw new Error('Invalid note length.');
    if (!Number.isFinite(volume) || volume < 0 || volume > 150) throw new Error('Invalid event volume.');
    if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0.05 || durationSeconds > 6)) throw new Error('Invalid hit duration.');
    if (!['flat', 'rise', 'drop'].includes(pitchFx)) throw new Error('Invalid pitch effect.');
    if (!Number.isFinite(pitchAmount) || pitchAmount < 0 || pitchAmount > 12) throw new Error('Invalid pitch intensity.');
    if (!Number.isFinite(echo) || echo < 0 || echo > 100) throw new Error('Invalid echo amount.');
    used.add(id);
    return {
      id, track, time, note, steps, volume, durationSeconds,
      pitchFx, pitchAmount, echo,
      soundId: resolveSound(track, item.soundId).id
    };
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export function createTimelineEvent({ track, time, soundId, note = 0, steps = 2, volume = 100, durationSeconds = null, pitchFx = 'flat', pitchAmount = 6, echo = 0 }) {
  if (!VALID_TRACKS.has(track)) throw new Error('Unknown track.');
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  return normalizeTimeline([{ id, track, time, soundId, note, steps, volume, durationSeconds, pitchFx, pitchAmount, echo }])[0];
}
export function moveTimelineEvent(events, id, time, track) {
  const old = events.find(x => x.id === id);
  if (!old) return events;
  const next = events.map(x => x.id === id ? {
    ...x, time, track,
    soundId: x.track === track ? x.soundId : resolveSound(track, track).id
  } : x);
  return normalizeTimeline(next);
}
export function nudgeTimelineEvent(events, id, delta, maxDuration) {
  const clip = events.find(item => item.id === id);
  if (!clip) return events;
  if (!Number.isFinite(delta) || !Number.isFinite(maxDuration)) return events;
  const time = Math.round(Math.max(0, Math.min(Math.max(0, maxDuration - 0.001), clip.time + delta)) * 10000) / 10000;
  return moveTimelineEvent(events, id, time, clip.track);
}
export function secondsLabel(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(safe / 60), s = Math.floor(safe % 60);
  return m + ':' + String(s).padStart(2, '0');
}
