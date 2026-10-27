import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, FolderOpen, Headphones, MousePointer2, Pause, Play,
  Plus, Trash2, Volume2, VolumeX, ZoomIn, ZoomOut
} from 'lucide-react';
import { TRACKS, SOUND_VARIANTS, resolveSound } from './audio/library.js';
import {
  createTimelineEvent, moveTimelineEvent, normalizeTimeline,
  secondsLabel, snapSeconds
} from './audio/timeline.js';
import { useLiveTransport } from './audio/useLiveTransport.js';

const ZOOMS = [8, 12, 18, 27, 40, 60, 90];
const MIN_WIDTH = 650;

function peaksFromBuffer(buffer, count) {
  const data = buffer.getChannelData(0);
  const segment = Math.max(1, Math.floor(data.length / count));
  return Array.from({ length: count }, (_, i) => {
    let peak = 0;
    const begin = i * segment;
    const end = Math.min(data.length, begin + segment);
    const stride = Math.max(1, Math.floor(segment / 30));
    for (let j = begin; j < end; j += stride) peak = Math.max(peak, Math.abs(data[j]));
    return Math.max(0.025, Math.min(1, peak));
  });
}

export default function LiveTimeline({ song, config, events, onChange, onError, onStopOutput, blocked }) {
  const [zoomIndex, setZoomIndex] = useState(2);
  const [snap, setSnap] = useState(false);
  const [follow, setFollow] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const fileRef = useRef(null);
  const scrollerRef = useRef(null);
  const duration = song ? song.duration / (Math.max(60, config.bpm) / Math.max(50, config.sourceBpm)) : 0;
  const zoom = ZOOMS[zoomIndex];
  const canvasWidth = Math.max(MIN_WIDTH, duration * zoom);
  const peaks = useMemo(() => song ? peaksFromBuffer(song.buffer, Math.max(70, Math.min(1200, Math.ceil(duration * 3)))) : [], [song?.buffer, duration]);
  const selected = events.find(e => e.id === selectedId) || null;
  const player = useLiveTransport({ song, config, events, duration, onError, onStart: onStopOutput });

  useEffect(() => {
    if (blocked && player.playing) player.pause();
  }, [blocked, player.playing, player.pause]);

  useEffect(() => {
    if (!follow || !player.playing || !scrollerRef.current) return;
    const scroller = scrollerRef.current;
    const target = Math.max(0, player.position * zoom - scroller.clientWidth * 0.45);
    scroller.scrollLeft = target;
  }, [player.position, player.playing, follow, zoom]);

  const rulerLabels = useMemo(() => {
    const gap = zoom >= 40 ? 2 : zoom >= 18 ? 5 : 10;
    const result = [];
    for (let seconds = 0; seconds <= duration + 0.01; seconds += gap) {
      result.push({ seconds, px: seconds * zoom });
    }
    return result;
  }, [duration, zoom]);

  function timeFromPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, (event.clientX - bounds.left) / zoom);
    return Math.min(Math.max(0, duration - 0.001), snapSeconds(raw, config.bpm, snap, config.beatOffset));
  }

  function addAt(track, time, playNow = false) {
    if (blocked || !song) return;
    if (events.length >= 5000) return onError('Timeline limit is 5,000 hits.');
    try {
      const clip = createTimelineEvent({
        track, time: Math.max(0, Math.min(duration - 0.001, time)),
        soundId: resolveSound(track, config.kit?.[track]).id,
        note: 0, steps: track === 'bass' ? 3 : 1
      });
      const next = normalizeTimeline([...events, clip]);
      onChange(next);
      setSelectedId(clip.id);
      if (playNow) player.trigger(clip);
    } catch (err) {
      onError(err.message || 'Could not add a sample.');
    }
  }

  function addAtPlayhead(track) {
    const time = player.getPosition();
    addAt(track, snapSeconds(time, config.bpm, snap, config.beatOffset), true);
  }

  function changeEvent(patch) {
    if (!selected) return;
    try {
      const next = normalizeTimeline(events.map(e => e.id === selected.id ? { ...e, ...patch } : e));
      onChange(next);
    } catch (err) {
      onError(err.message);
    }
  }

  function deleteEvent(id) {
    onChange(events.filter(e => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function dropEvent(event, track) {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-phonkforge-event');
    if (!id || !events.some(e => e.id === id)) return;
    try {
      const newTime = timeFromPointer(event);
      onChange(moveTimelineEvent(events, id, newTime, track));
      setSelectedId(id);
    } catch (err) {
      onError(err.message);
    }
  }

  function saveProject() {
    const project = {
      format: 'phonkforge-timeline', version: 1,
      source: song?.name || null, sourceBpm: config.sourceBpm,
      bpm: config.bpm, key: config.key, events,
      kit: config.kit, trackGains: config.trackGains, trackMutes: config.trackMutes
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'phonkforge-live-timeline.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadProject(file) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Timeline JSON exceeds 1 MB.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'phonkforge-timeline' || data.version !== 1) {
        throw new Error('Not a valid PhonkForge timeline file.');
      }
      const loaded = normalizeTimeline(data.events);
      const updates = {};
      if (Number.isFinite(data.bpm) && data.bpm >= 60 && data.bpm <= 210) updates.bpm = Math.round(data.bpm);
      if (Number.isFinite(data.sourceBpm) && data.sourceBpm >= 50 && data.sourceBpm <= 240) updates.sourceBpm = Math.round(data.sourceBpm);
      if (typeof data.key === 'string' && /^(?:[A-G]#?)$/.test(data.key)) updates.key = data.key;
      if (data.kit && typeof data.kit === 'object') updates.kit = Object.fromEntries(TRACKS.map(track =>
        [track.id, resolveSound(track.id, data.kit[track.id]).id]));
      if (data.trackGains && typeof data.trackGains === 'object') updates.trackGains = Object.fromEntries(TRACKS.map(track =>
        [track.id, Number.isFinite(data.trackGains[track.id]) ? Math.max(0, Math.min(150, data.trackGains[track.id])) : (config.trackGains?.[track.id] ?? 100)]));
      if (data.trackMutes && typeof data.trackMutes === 'object') updates.trackMutes = Object.fromEntries(TRACKS.map(track =>
        [track.id, data.trackMutes[track.id] === true]));
      onChange(loaded, updates);
      player.pause();
      setSelectedId(null);
      if (data.source && data.source !== song?.name) {
        onError('Imported events reference "' + data.source + '". Load that source to ensure timing matches.');
      }
    } catch (err) {
      onError(err.message || 'Could not import timeline.');
    }
  }

  if (!song) {
    return <div className="timeline-empty">
      <Headphones size={26}/>
      <strong>IMPORT A TRACK TO EDIT ITS TIMELINE</strong>
      <span>Load your song first, then play it and drop original kick, snare, bass and FX hits onto exact seconds.</span>
    </div>;
  }

  return (
    <div className="live-timeline">
      <div className="timeline-transport">
        <button className="timeline-play" onClick={player.play} disabled={blocked} aria-label={player.playing ? 'Pause timeline' : 'Play timeline'}>
          {player.playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}
        </button>
        <div className="timeline-clock"><strong>{secondsLabel(player.position)}<small>.{String(Math.floor((player.position % 1) * 100)).padStart(2, '0')}</small></strong><span>/ {secondsLabel(duration)}</span></div>
        <label className="timeline-toggle"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/> SNAP TO 1/16</label>
        <label className="timeline-toggle"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)}/> FOLLOW</label>
        <div className="timeline-zoom"><button title="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex(n => Math.max(0, n - 1))}><ZoomOut size={15}/></button><span>{zoom} PX/S</span><button title="Zoom in" disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex(n => Math.min(ZOOMS.length - 1, n + 1))}><ZoomIn size={15}/></button></div>
      </div>
      <input aria-label="Seek across song" className="timeline-seek" type="range" min={0} max={Math.max(duration, 0.001)} step="0.01" value={player.position}
        onChange={e => player.seek(Number(e.target.value))} disabled={blocked}/>

      <div className="timeline-intro"><MousePointer2 size={15}/><span>Play the track, then press <b>+ AT PLAYHEAD</b> on any lane for an instant hit. Click empty space to place a hit at an exact time; drag hits to move them.</span></div>

      <div className="timeline-editor-layout">
        <div className="timeline-lane-headings">
          <div className="timeline-label-ruler">TIME RULER</div>
          <div className="timeline-label-wave">SOURCE WAVEFORM</div>
          {TRACKS.map(track => <div key={track.id} className="timeline-track-label" style={{ '--track-color': track.color }}>
            <span><b>{track.label}</b><small>{(events.filter(x => x.track === track.id)).length} HITS</small></span>
            <select title={'Sample for new '+track.label+' hits'} aria-label={'Sound for ' + track.label} value={config.kit?.[track.id] || track.id}
              onChange={e => onChange(events, { kit: { ...config.kit, [track.id]: e.target.value } })}>
              {SOUND_VARIANTS[track.id].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <div className="timeline-track-controls">
              <button title="Add hit now" onClick={() => addAtPlayhead(track.id)}><Plus size={13}/> AT PLAYHEAD</button>
              <button title="Mute track" className={config.trackMutes?.[track.id] ? 'muted' : ''}
                onClick={() => onChange(events, { trackMutes: { ...config.trackMutes, [track.id]: !config.trackMutes?.[track.id] } })}>
                {config.trackMutes?.[track.id] ? <VolumeX size={15}/> : <Volume2 size={15}/>}
              </button>
            </div>
          </div>)}
        </div>
        <div className="timeline-scroller" ref={scrollerRef} onScroll={() => { /* native scroll controls long-form navigation */ }}>
          <div className="timeline-canvas" style={{ width: canvasWidth }}>
            <div className="timeline-playhead" style={{ left: Math.min(canvasWidth, player.position * zoom) }}><span/></div>
            <div className="timeline-ruler" onClick={e => player.seek(timeFromPointer(e))} title="Click to seek">
              {rulerLabels.map(label => <span key={label.seconds} className="timeline-tick" style={{ left: label.px }}>{secondsLabel(label.seconds)}</span>)}
            </div>
            <div className="timeline-waveform" onClick={e => player.seek(timeFromPointer(e))} title="Click waveform to seek">
              <svg viewBox={'0 0 ' + Math.max(1, peaks.length) + ' 64'} preserveAspectRatio="none" style={{ width: '100%', height: 64 }}>
                {peaks.map((p, index) => <rect key={index} x={index} y={(64 - p * 56) / 2} width=".72" height={p * 56} fill="#bc5267" opacity=".72"/>)}
              </svg>
            </div>
            {TRACKS.map(track => <div key={track.id} className="timeline-lane" style={{ '--track-color': track.color }}
              onClick={e => addAt(track.id, timeFromPointer(e))}
              onDragOver={e => e.preventDefault()} onDrop={e => dropEvent(e, track.id)}>
              {events.filter(x => x.track === track.id && x.time <= duration).map(event => {
                const width = event.track === 'bass' ? Math.max(23, event.steps * (60 / config.bpm / 4) * zoom) : 24;
                const chosen = selectedId === event.id;
                return <button type="button" draggable disabled={blocked} key={event.id}
                  style={{ left: event.time * zoom, width }} title={event.soundId + ' · ' + event.time.toFixed(2) + 's'}
                  className={'timeline-clip ' + (chosen ? 'selected' : '')}
                  onDragStart={e => { e.dataTransfer.setData('application/x-phonkforge-event', event.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={e => { e.stopPropagation(); setSelectedId(event.id); }}
                  aria-label={'Select '+event.soundId+' at '+event.time.toFixed(2)+' seconds'}>
                  {track.id === 'bass' || track.id === 'bell' ? (event.note > 0 ? '+' : '') + event.note : '●'}
                </button>;
              })}
            </div>)}
          </div>
        </div>
      </div>

      <div className="timeline-inspector">
        <div className="timeline-inspector-title"><strong>HIT INSPECTOR</strong><small>{selected ? 'Select, adjust, or delete the highlighted sample.' : 'Click a hit on the timeline to edit its exact position.'}</small></div>
        {selected ? <div className="timeline-inspector-grid">
          <label>TRACK<select value={selected.track} onChange={e => changeEvent({
            track: e.target.value, soundId: resolveSound(e.target.value, e.target.value).id
          })}>{TRACKS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label>SAMPLE<select value={selected.soundId} onChange={e => changeEvent({ soundId: e.target.value })}>{SOUND_VARIANTS[selected.track].map(([id,name]) => <option value={id} key={id}>{name}</option>)}</select></label>
          <label>SECOND<input aria-label="Event position in seconds" type="number" min="0" max={duration.toFixed(2)} step=".01" value={Number(selected.time.toFixed(2))} onChange={e => changeEvent({ time: Math.max(0, Math.min(duration - 0.001, Number(e.target.value))) })}/></label>
          {(selected.track === 'bass' || selected.track === 'bell') && <>
            <label>PITCH ±12<input aria-label="Event pitch semitones" type="number" min="-12" max="12" step="1" value={selected.note} onChange={e => changeEvent({ note: Number(e.target.value) })}/></label>
            <label>LENGTH (STEPS)<input aria-label="Event length steps" type="number" min="1" max="16" value={selected.steps} onChange={e => changeEvent({ steps: Number(e.target.value) })}/></label>
          </>}
          <label>HIT LEVEL<input aria-label="Event volume percent" type="number" min="0" max="150" value={selected.volume} onChange={e => changeEvent({ volume: Number(e.target.value) })}/></label>
          <button className="timeline-go" onClick={() => player.seek(selected.time)}><Play size={14}/> SEEK TO HIT</button>
          <button className="timeline-delete" onClick={() => deleteEvent(selected.id)}><Trash2 size={14}/> DELETE HIT</button>
        </div> : <div className="timeline-inspector-empty">Select a clip to fine-tune its position, sound, pitch and length.</div>}
      </div>

      <div className="timeline-mixer">
        <strong>LIVE TRACK MIXER</strong>
        <div className="timeline-mixer-grid">{TRACKS.map(track =>
          <label key={track.id} style={{ '--track-color': track.color }}>
            <span>{track.label}<output>{config.trackGains?.[track.id] ?? 100}%</output></span>
            <input type="range" min="0" max="150" value={config.trackGains?.[track.id] ?? 100}
              onChange={e => onChange(events, { trackGains: { ...config.trackGains, [track.id]: Number(e.target.value) } })}/>
          </label>
        )}</div>
      </div>
      <div className="timeline-footer">
        <span><b>{events.length}</b> PLACED HITS <span className="timeline-hint">· source audio and synth play together, before export</span></span>
        <div className="timeline-footer-actions">
          <button className="outline small" onClick={saveProject}><Download size={13}/> SAVE PROJECT</button>
          <button className="outline small" onClick={() => fileRef.current?.click()}><FolderOpen size={13}/> LOAD PROJECT</button>
          <button className="outline small" onClick={() => { if (events.length && window.confirm('Delete all timeline hits?')) { onChange([]); setSelectedId(null); } }}><Trash2 size={13}/> CLEAR</button>
          <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={e => { loadProject(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      <p className="manual-disclaimer">Timeline locations use output seconds after target-BPM adjustment. Changing BPM changes the location of the original song relative to fixed events. Use WAV export after previewing. Multitrack audio clips and stem splitting are not yet implemented.</p>
    </div>
  );
}
