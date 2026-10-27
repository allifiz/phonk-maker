import React, { useRef, useState } from 'react';
import { Download, FolderOpen, Headphones, RotateCcw, Trash2, Volume2, VolumeX } from 'lucide-react';
import { TRACKS, SOUND_VARIANTS } from './audio/library.js';
import {
  emptyPattern, normalizeKit, normalizePattern, normalizeTrackValues,
  patternFromPreset, setStepLength, setStepNote, toggleStep, TONAL_TRACKS,
  DEFAULT_TRACK_GAINS, DEFAULT_TRACK_MUTES
} from './audio/patterns.js';

function activeStep(item) {
  return Array.isArray(item) ? item[0] : item;
}
function findNote(pattern, track, step) {
  return (pattern[track] || []).find(item => Array.isArray(item) && item[0] === step);
}
function exportPattern(config) {
  const project = {
    format: 'phonkforge-pattern', version: 1,
    preset: config.preset, bpm: config.bpm, key: config.key,
    pattern: config.manualPattern, kit: config.kit,
    trackGains: config.trackGains, trackMutes: config.trackMutes
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'phonkforge-' + config.preset + '-pattern.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ManualSequencer({ config, onChange, onAudition, onPreviewLoop, previewing, onError }) {
  const fileRef = useRef(null);
  const [selected, setSelected] = useState({ track: 'bass', step: 0 });
  const pattern = config.manualPattern;
  const gridRows = TRACKS;

  function editStep(track, step) {
    const found = (pattern[track] || []).some(item => activeStep(item) === step);
    onChange({ manualPattern: toggleStep(pattern, track, step) });
    if (!found && TONAL_TRACKS.has(track)) setSelected({ track, step });
  }
  function importProject(file) {
    if (!file) return;
    file.text().then(text => {
      if (text.length > 100_000) throw new Error('Pattern JSON is too large.');
      const project = JSON.parse(text);
      if (project.format !== 'phonkforge-pattern' || project.version !== 1) throw new Error('Not a PhonkForge pattern v1.');
      const changes = {
        manualPattern: normalizePattern(project.pattern),
        kit: normalizeKit(project.kit),
        trackGains: normalizeTrackValues(project.trackGains, DEFAULT_TRACK_GAINS, 0, 150, true),
        trackMutes: normalizeTrackValues(project.trackMutes, DEFAULT_TRACK_MUTES, 0, 1, false)
      };
      if (Number.isInteger(project.bpm) && project.bpm >= 60 && project.bpm <= 210) changes.bpm = project.bpm;
      if (typeof project.key === 'string' && /^[A-G]#?$/.test(project.key)) changes.key = project.key;
      onChange(changes);
    }).catch(err => onError(err.message || 'Could not import pattern.'));
  }

  return (
    <div className="manual-studio">
      <div className="manual-toolbar">
        <div className="manual-copy">
          <strong>16-STEP REMIX SEQUENCER</strong>
          <small>The pattern loops over your entire track. Click steps to add or remove hits.</small>
        </div>
        <div className="manual-actions">
          <button className="outline small" onClick={() => onChange({ manualPattern: patternFromPreset(config.preset) })}><RotateCcw size={13}/> LOAD PRESET</button>
          <button className="outline small" onClick={() => onChange({ manualPattern: emptyPattern() })}><Trash2 size={13}/> CLEAR</button>
        </div>
      </div>
      <div className="sequencer-scroll">
      <div className="manual-step-labels">
        <span>TRACK / SOUND</span>
        <div>{Array.from({ length: 16 }, (_, i) => <span className={(i % 4 === 0 ? 'beat-marker' : '')} key={i}>{i + 1}</span>)}</div>
      </div>
        {gridRows.map(track => {
          const family = SOUND_VARIANTS[track.id];
          const isMute = config.trackMutes?.[track.id] || false;
          const active = new Set((pattern[track.id] || []).map(activeStep));
          return <div key={track.id} className={'sequencer-row ' + (isMute ? 'muted' : '')} style={{ '--track-color': track.color }}>
            <div className="seq-track-top">
              <span className="seq-track-name">{track.label}</span>
              <select aria-label={'Sound for ' + track.label} value={config.kit?.[track.id] || track.id} onChange={e => onChange({ kit: { ...config.kit, [track.id]: e.target.value } })}>
                {family.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
              </select>
              <button title={'Preview ' + track.label} aria-label={'Preview ' + track.label} className="seq-icon-btn" onClick={() => onAudition(config.kit?.[track.id] || track.id)}><Headphones size={14}/></button>
              <button title={isMute ? 'Unmute' : 'Mute'} aria-label={(isMute ? 'Unmute ' : 'Mute ') + track.label}
                className={'seq-icon-btn ' + (isMute ? 'seq-is-muted' : '')}
                onClick={() => onChange({ trackMutes: { ...config.trackMutes, [track.id]: !isMute } })}>
                {isMute ? <VolumeX size={14}/> : <Volume2 size={14}/>}
              </button>
            </div>
            <div className="seq-grid" role="group" aria-label={track.label + ' pattern'}>
              {Array.from({ length: 16 }, (_, step) =>
                <button key={step} type="button" className={'seq-step ' + (active.has(step) ? 'hit' : '') + (step % 4 === 0 ? ' beat-start' : '')}
                  style={{ '--track-color': track.color }} aria-pressed={active.has(step)} aria-label={track.label + ' step ' + (step + 1)}
                  onClick={() => editStep(track.id, step)}>
                  {active.has(step) && TONAL_TRACKS.has(track.id) ? (() => {
                    const data = findNote(pattern, track.id, step);
                    return data && data[1] !== 0 ? (data[1] > 0 ? '+' : '') + data[1] : '●';
                  })() : ''}
                </button>)}
            </div>
            <div className="seq-volume">
              <label>VOL <output>{config.trackGains?.[track.id] ?? 100}%</output></label>
              <input aria-label={track.label + ' volume'} type="range" min="0" max="150" value={config.trackGains?.[track.id] ?? 100}
                onChange={e => onChange({ trackGains: { ...config.trackGains, [track.id]: Number(e.target.value) } })}/>
            </div>
          </div>;
        })}
      </div>
      <div className="note-editor">
        <div className="note-title"><strong>PIANO NOTE EDITOR</strong><small>Choose an active 808 or cowbell step to change its pitch.</small></div>
        <label>TRACK<select value={selected.track} onChange={e => setSelected({ track: e.target.value, step: 0 })}>
          <option value="bass">808 BASS</option><option value="bell">COWBELL</option>
        </select></label>
        <label>STEP<select value={selected.step} onChange={e => setSelected(v => ({ ...v, step: Number(e.target.value) }))}>
          {Array.from({ length: 16 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
        </select></label>
        <label>SEMITONES<select disabled={!findNote(pattern, selected.track, selected.step)}
          value={findNote(pattern, selected.track, selected.step)?.[1] || 0}
          onChange={e => onChange({ manualPattern: setStepNote(pattern, selected.track, selected.step, Number(e.target.value)) })}>
          {Array.from({ length: 25 }, (_, i) => i - 12).map(n => <option key={n} value={n}>{n > 0 ? '+' : ''}{n}</option>)}
        </select></label>
        {selected.track === 'bass' && <label>LENGTH<select disabled={!findNote(pattern, 'bass', selected.step)}
          value={findNote(pattern, 'bass', selected.step)?.[2] || 2}
          onChange={e => onChange({ manualPattern: setStepLength(pattern, selected.step, Number(e.target.value)) })}>
          {Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1} STEPS</option>)}
        </select></label>}
      </div>
      <div className="seq-footer">
        <label className="manual-bars">BEAT LENGTH (NO SOURCE) <select value={config.manualBars || 32} onChange={e => onChange({ manualBars: Number(e.target.value) })}>{[8, 16, 32, 64].map(bars => <option key={bars} value={bars}>{bars} BARS</option>)}</select></label>
        <button className="seq-preview" onClick={onPreviewLoop} disabled={previewing === 'loop'}><Headphones size={16}/>{previewing === 'loop' ? 'PREPARING...' : 'AUDITION 4-BAR LOOP'}</button>
        <button className="outline small" onClick={() => exportPattern(config)}><Download size={14}/> EXPORT PATTERN</button>
        <button className="outline small" onClick={() => fileRef.current?.click()}><FolderOpen size={14}/> IMPORT PATTERN</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { importProject(e.target.files?.[0]); e.target.value = ''; }}/>
      </div>
      <p className="manual-disclaimer">Step patterns repeat across the imported song. Without a song, export an original beat with the selected number of bars. Detailed multitrack waveform editing and automation are not yet included.</p>
    </div>
  );
}
