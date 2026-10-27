import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AudioLines, AudioWaveform, Check, ChevronRight, CircleHelp,
  Disc3, Download, FileAudio, FolderOpen, Headphones, Layers3, Music2,
  Pause, Play, RotateCcw, Settings2, SlidersHorizontal, Sparkles,
  Volume2, WandSparkles, Zap
} from 'lucide-react';
import { decodeMusic, previewInstrument, renderRemix } from './audio/engine.js';
import { estimateBpm } from './audio/bpm.js';
import { PRESETS, TONICS } from './audio/presets.js';
import { SOUND_LIBRARY, kitForPreset } from './audio/library.js';
import { patternFromPreset, normalizePattern, normalizeKit, normalizeTrackValues, DEFAULT_TRACK_GAINS, DEFAULT_TRACK_MUTES } from './audio/patterns.js';
import ManualSequencer from './ManualSequencer.jsx';
import LiveTimeline from './LiveTimeline.jsx';
import { normalizeTimeline } from './audio/timeline.js';

const INITIAL = {
  preset: 'drift', bpm: 150, sourceBpm: 120, key: 'A',
  aggression: 82, bass: 80, cowbell: true, effects: true,
  keepOriginal: true, beatOffset: 0,
  mode: 'auto', manualBars: 32, manualPattern: patternFromPreset('drift'),
  kit: kitForPreset('drift'), trackGains: { ...DEFAULT_TRACK_GAINS },
  trackMutes: { ...DEFAULT_TRACK_MUTES }
};

const GROUPS = ['DRUMS', 'BASS', 'MELODY', 'FX'];
const floor = x => Math.max(0, x);
function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}
function waveform(buffer, count = 130) {
  if (!buffer) return Array.from({ length: count }, (_, i) =>
    0.18 + 0.3 * Math.abs(Math.sin(i * 0.38) * Math.cos(i * 0.11)));
  const channel = buffer.getChannelData(0);
  const windowSize = Math.floor(channel.length / count);
  return Array.from({ length: count }, (_, i) => {
    let max = 0;
    const from = i * windowSize;
    const stride = Math.max(1, Math.floor(windowSize / 90));
    for (let j = from; j < from + windowSize && j < channel.length; j += stride) {
      max = Math.max(max, Math.abs(channel[j]));
    }
    return Math.max(0.08, Math.min(1, max));
  });
}
function Waveform({ buffer, progress = 0, active = false }) {
  const peaks = useMemo(() => waveform(buffer), [buffer]);
  return (
    <svg className="wave" viewBox="0 0 650 124" preserveAspectRatio="none" role="img" aria-label="Audio waveform">
      <defs>
        <linearGradient id="waveGradient" x1="0" x2="1">
          <stop offset="0" stopColor="#f97078" />
          <stop offset="1" stopColor="#955cff" />
        </linearGradient>
      </defs>
      <line x1="0" y1="62" x2="650" y2="62" stroke="#2f3240" />
      {peaks.map((p, i) => {
        const height = p * 100;
        return <rect key={i} x={i * 5 + 0.9} y={(124 - height) / 2} width="2.7" height={height} rx="1.5"
          fill={active && i / peaks.length < progress ? 'url(#waveGradient)' : '#484451'} />;
      })}
    </svg>
  );
}
function KnobSlider({ label, value, min = 0, max = 100, suffix = '%', onChange, hint }) {
  return (
    <div className="setting-slider">
      <div className="setting-label"><span>{label}</span><strong>{value}{suffix}</strong></div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ '--fill': ((value - min) / (max - min) * 100) + '%' }} aria-label={label} />
      {hint && <small>{hint}</small>}
    </div>
  );
}
function Switch({ label, detail, checked, onChange }) {
  return (
    <label className="switch-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch-visual" aria-hidden="true" />
    </label>
  );
}

export default function App() {
  const [tab, setTab] = useState('studio');
  const [config, setConfig] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('phonkforge-pattern-v1'));
      if (saved?.version === 1) return {
        ...INITIAL,
        manualPattern: normalizePattern(saved.manualPattern),
        kit: normalizeKit(saved.kit),
        trackGains: normalizeTrackValues(saved.trackGains, DEFAULT_TRACK_GAINS, 0, 150, true),
        trackMutes: normalizeTrackValues(saved.trackMutes, DEFAULT_TRACK_MUTES, 0, 1, false)
      };
    } catch { /* Use default grid if storage is unavailable or corrupt. */ }
    return INITIAL;
  });
  const [song, setSong] = useState(null);
  const [timelineEvents, setTimelineEvents] = useState(() => {
    try {
      return normalizeTimeline(JSON.parse(localStorage.getItem('phonkforge-live-timeline-v1') || '[]'));
    } catch { return []; }
  });
  const [output, setOutput] = useState(null);
  const [busy, setBusy] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const renderController = useRef(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [previewing, setPreviewing] = useState('');
  const inputRef = useRef(null);
  const audioRef = useRef(null);
  const oneShotRef = useRef(null);
  const preset = PRESETS[config.preset];
  useEffect(() => {
    try { localStorage.setItem('phonkforge-live-timeline-v1', JSON.stringify(timelineEvents)); }
    catch { /* Browser storage is optional. */ }
  }, [timelineEvents]);
  useEffect(() => {
    try {
      localStorage.setItem('phonkforge-pattern-v1', JSON.stringify({
        version: 1, manualPattern: config.manualPattern, kit: config.kit,
        trackGains: config.trackGains, trackMutes: config.trackMutes
      }));
    } catch { /* Storage is optional. */ }
  }, [config.manualPattern, config.kit, config.trackGains, config.trackMutes]);

  useEffect(() => () => {
    if (output?.url) URL.revokeObjectURL(output.url);
  }, [output?.url]);

  function update(patch) {
    setConfig(previous => ({ ...previous, ...patch }));
    setDirty(true);
  }

  function pickPreset(id) {
    const chosen = PRESETS[id];
    update({ preset: id, bpm: chosen.bpm, kit: kitForPreset(id) });
  }

  async function importFile(file) {
    if (!file) return;
    setImporting(true);
    setError('');
    setPlaying(false);
    setOutput(null);
    setSong(null);
    if (audioRef.current) audioRef.current.pause();
    try {
      const buffer = await decodeMusic(file);
      const foundBpm = estimateBpm(buffer);
      setSong({ name: file.name, duration: buffer.duration, buffer, detectedBpm: foundBpm });
      setConfig(previous => ({ ...previous, sourceBpm: foundBpm || 120 }));
      setDirty(true);
    } catch (err) {
      setError(err.message || 'Could not load this audio file.');
    } finally {
      setImporting(false);
    }
  }

  async function generate() {
    if ((!song && config.mode !== 'manual') || busy) return;
    setBusy(true);
    setRenderProgress(0);
    const controller = new AbortController();
    renderController.current = controller;
    setError('');
    setPlaying(false);
    if (audioRef.current) audioRef.current.pause();
    try {
      let input = song?.buffer;
      let options = config;
      if (!song && config.mode === 'manual') {
        const seconds = (config.manualBars || 32) * 240 / Math.max(60, config.bpm);
        const silence = new Float32Array(Math.ceil(seconds * 44100));
        input = { duration: seconds, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => silence };
        options = { ...config, keepOriginal: false, sourceBpm: config.bpm, beatOffset: 0 };
      }
      const rendered = await renderRemix(input, { ...options, timelineEvents }, setRenderProgress, controller.signal);
      const url = URL.createObjectURL(rendered.blob);
      setOutput({ ...rendered, url });
      setPosition(0);
      setDirty(false);
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err?.message || 'Rendering failed. Try a shorter audio file.');
    } finally {
      renderController.current = null;
      setBusy(false);
    }
  }

  function togglePlay() {
    const player = audioRef.current;
    if (!player) return;
    if (player.paused) {
      player.play().then(() => setPlaying(true)).catch(() => setError('Unable to play preview.'));
    } else {
      player.pause();
      setPlaying(false);
    }
  }

  function download() {
    if (!output?.url) return;
    const a = document.createElement('a');
    const title = song ? song.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-') : 'original-phonk-beat';
    a.href = output.url;
    a.download = title + '-' + config.mode + '-' + config.preset + '-phonkforge.wav';
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function playPreview(blob, id) {
    if (oneShotRef.current) oneShotRef.current.pause();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    oneShotRef.current = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      setPreviewing(previous => previous === id ? '' : previous);
    };
    audio.addEventListener('ended', cleanup, { once: true });
    audio.addEventListener('error', cleanup, { once: true });
    try { await audio.play(); } catch (error) { cleanup(); throw error; }
  }

  async function audition(id) {
    if (previewing) return;
    setPreviewing(id);
    setError('');
    try {
      const clip = await previewInstrument(id, config.key);
      await playPreview(clip, id);
    } catch {
      setError('Sound preview could not start.');
      setPreviewing('');
    }
  }
  async function auditionManualLoop() {
    if (previewing) return;
    setPreviewing('loop');
    setError('');
    try {
      const seconds = 4 * 240 / Math.max(60, config.bpm);
      const silence = new Float32Array(Math.ceil(seconds * 44100));
      const input = { duration: seconds, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => silence };
      const options = { ...config, mode: 'manual', sourceBpm: config.bpm, keepOriginal: false, beatOffset: 0 };
      const { blob } = await renderRemix(input, options);
      await playPreview(blob, 'loop');
    } catch {
      setError('Could not preview the manual loop.');
      setPreviewing('');
    }
  }

  const rate = config.bpm / config.sourceBpm;
  const minutes = song ? timeLabel(song.duration / rate) : config.mode === 'manual' ? timeLabel((config.manualBars || 32) * 240 / Math.max(60, config.bpm)) : '--:--';
  const tooLong = song && song.duration / rate > 15 * 60;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-icon"><AudioWaveform size={25} /></div><span>PHONK<span className="brand-strong">FORGE</span><small>REMIX LAB / 001</small></span></div>
        <div className="side-caption">WORKSPACE</div>
        <nav>
          <button className={'nav-item ' + (tab === 'studio' ? 'selected' : '')} onClick={() => setTab('studio')}><SlidersHorizontal size={18}/> Remix Studio <ChevronRight size={15} className="nav-chevron"/></button>
          <button className={'nav-item ' + (tab === 'library' ? 'selected' : '')} onClick={() => setTab('library')}><Layers3 size={18}/> Sound Library <span className="count">{SOUND_LIBRARY.length}</span></button>
          <button className={'nav-item ' + (tab === 'about' ? 'selected' : '')} onClick={() => setTab('about')}><CircleHelp size={18}/> How it works</button>
        </nav>
        <div className="side-spacer" />
        <div className="side-card"><Zap size={16}/><strong>BUILT TO HIT HARD</strong><p>Original drum synthesis. Local rendering. No cloud, no paid sample packs.</p></div>
        <div className="side-footer"><span className="status-dot" /> AUDIO ENGINE READY <small>v0.1.0 · LOCAL BUILD</small></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">PHONKFORGE <span>/</span> {tab === 'studio' ? 'REMIX STUDIO' : tab === 'library' ? 'SOUND LIBRARY' : 'DOCUMENTATION'}</div>
          <div className="top-status"><span className="status-dot" /> OFFLINE ENGINE <span className="top-divider" /> <Headphones size={16}/> DESKTOP STUDIO</div>
        </header>

        {tab === 'studio' && (
          <div className="workspace">
            <section className="content">
              <div className="hero">
                <div className="eyebrow"><span className="eyebrow-mark"/> THE REMIX IS YOURS</div>
                <h1>MAKE IT <em>HIT</em><br/>HARDER<span className="red-period">.</span></h1>
                <p>Any track. An original drum kit. A whole new energy.<br/>Build a phonk remix directly on your machine.</p>
                <div className="hero-ring" aria-hidden="true"><Disc3 size={175} strokeWidth={0.5}/></div>
              </div>

              <div className="section-head"><div><span className="step">01</span><strong>SOURCE AUDIO</strong></div><span className="muted-label">IMPORT YOUR TRACK</span></div>
              <div className={'track-panel ' + (dragging ? 'dragging' : '')} onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={e => { e.preventDefault(); setDragging(false); }}
                onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files?.[0]); }}>
                <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac" hidden onChange={e => importFile(e.target.files?.[0])} />
                {song ? (
                  <>
                    <div className="track-top"><div className="track-art"><Music2 size={22}/></div>
                      <div className="track-name"><strong title={song.name}>{song.name}</strong><span>{timeLabel(song.duration)} · SOURCE · {song.detectedBpm ? 'BPM EST. ' + song.detectedBpm : 'BPM UNKNOWN'}</span></div>
                      <button className="outline small" onClick={() => inputRef.current?.click()}><RotateCcw size={14}/> REPLACE</button>
                    </div>
                    <div className="wave-container"><Waveform buffer={song.buffer}/><div className="wave-times"><span>0:00</span><span>{timeLabel(song.duration / 2)}</span><span>{timeLabel(song.duration)}</span></div></div>
                  </>
                ) : (
                  <div className="upload-empty">
                    <div className="upload-icon"><FileAudio size={29}/></div>
                    <strong>{importing ? 'ANALYZING TRACK...' : 'DROP AN AUDIO FILE HERE'}</strong>
                    <span>MP3, WAV, OGG, M4A, FLAC · up to 100 MB</span>
                    <button disabled={importing} className="outline" onClick={() => inputRef.current?.click()}><FolderOpen size={16}/> BROWSE FILES</button>
                  </div>
                )}
              </div>

              <div className="section-head"><div><span className="step">02</span><strong>CHOOSE YOUR ENERGY</strong></div><span className="muted-label">4 SIGNATURE SOUNDS</span></div>
              <div className="preset-grid">
                {Object.values(PRESETS).map(p => (
                  <button key={p.id} onClick={() => pickPreset(p.id)} className={'preset-card ' + (config.preset === p.id ? 'active' : '')}
                    style={{ '--preset-color': p.accent }}>
                    <div className="preset-top"><span className="preset-indicator"><AudioLines size={21}/></span>{config.preset === p.id ? <Check size={17} className="selected-check"/> : <span className="unselected-ring"/>}</div>
                    <small>{p.genre}</small><strong>{p.name}</strong><span>{p.subtitle}</span>
                    <div className="preset-bottom"><span>{p.bpm} BPM</span><span>16 STEP GRID</span></div>
                  </button>
                ))}
              </div>

              <div className="section-head"><div><span className="step">03</span><strong>REMIX WORKFLOW</strong></div><span className="muted-label">AUTO · PATTERN · LIVE TIMELINE</span></div>
              <div className="mode-selector" role="group" aria-label="Remix mode">
                <button className={config.mode === 'auto' ? 'chosen' : ''} onClick={() => update({ mode: 'auto' })}><WandSparkles size={17}/> AUTO REMIX <small>Genre arrangement, fills and breaks</small></button>
                <button className={config.mode === 'manual' ? 'chosen' : ''} onClick={() => update({ mode: 'manual' })}><SlidersHorizontal size={17}/> PATTERN MAKER <small>Repeat a custom 16-step beat</small></button>
                <button className={config.mode === 'timeline' ? 'chosen' : ''} onClick={() => update({ mode: 'timeline' })}><AudioWaveform size={17}/> LIVE TIMELINE <small>Play music and place hits at exact seconds</small></button>
              </div>
              {config.mode === 'manual' ? (
                <ManualSequencer config={config} onChange={update} onAudition={audition} onPreviewLoop={auditionManualLoop} previewing={previewing} onError={setError}/>
              ) : config.mode === 'timeline' ? (
                <LiveTimeline song={song} config={config} events={timelineEvents} blocked={busy} onError={setError}
                  onStopOutput={() => { if (audioRef.current) audioRef.current.pause(); }}
                  onChange={(events, patch) => {
                    if (events !== timelineEvents) { setTimelineEvents(events); setDirty(true); }
                    if (patch) update(patch);
                  }}/>
              ) : <p className="mode-explanation">Auto mode builds a whole arrangement from a genre preset. Pattern Maker loops a custom 16-step beat. Live Timeline plays your source while you place individual hits at exact seconds.</p>
              }
              <div className="section-head"><div><span className="step">04</span><strong>RENDER YOUR REMIX</strong></div><span className="muted-label">OFFLINE RENDER</span></div>
              <div className="render-card">
                <div className="render-top"><div className="render-title"><div className="render-icon"><WandSparkles size={23}/></div>
                  <div><strong>{config.mode === 'timeline' ? 'LIVE TIMELINE EXPORT' : config.mode === 'manual' ? 'PATTERN PHONK RENDERER' : 'PHONK GENERATOR'}</strong><span>{song || config.mode === 'manual' ? 'Estimated ' + minutes + ' output · ' + config.bpm + ' BPM' : 'Import a track or switch to manual mode'}</span></div></div>
                  <span className="engine-badge">WAV · 44.1 KHZ</span>
                </div>
                {tooLong && <p className="warning">This output exceeds 15 minutes. Shorten the source or increase target BPM.</p>}
                <button className="generate-btn" disabled={(!song && config.mode !== 'manual') || busy || importing || tooLong} onClick={generate}>
                  {busy ? <><Activity size={19} className="spin"/> RENDERING {renderProgress}%...</> : <><Zap size={20} fill="currentColor"/> GENERATE PHONK REMIX <ChevronRight size={19}/></>}
                </button>
                {busy && <div className="render-progress" role="status"><div><span>RENDERING WAV · {renderProgress}% COMPLETE</span><button onClick={() => renderController.current?.abort()}>CANCEL RENDER</button></div><progress max="100" value={renderProgress} aria-label="Render progress" /></div>}
                <p className="render-note">{config.mode === 'timeline' ? 'Export exactly the hit positions shown in Live Timeline.' : 'Beat-sequenced synthesized kick, 808, snare, hats, cowbell and FX.'} Up to 15 minutes per render.</p>
              </div>

              {output && (
                <div className="output-card">
                  <div className="output-heading"><div><span className="finished-dot"/> <strong>RENDER COMPLETE</strong> <span className="muted-label">{output.hits.toLocaleString()} SYNTH HITS</span></div><span>{dirty ? 'SETTINGS CHANGED · RE-RENDER TO UPDATE' : 'READY TO EXPORT'}</span></div>
                  <audio ref={audioRef} src={output.url} onTimeUpdate={e => setPosition(e.currentTarget.currentTime)}
                    onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
                  <div className="player"><button className="play-button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button>
                    <div className="player-middle"><Waveform buffer={song?.buffer} active progress={floor(position / output.duration)}/>
                      <input className="seek" aria-label="Seek output" type="range" min="0" max={output.duration} step="0.1" value={Math.min(position, output.duration)}
                        onChange={e => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); setPosition(Number(e.target.value)); }} />
                    </div><span className="player-time">{timeLabel(position)} / {timeLabel(output.duration)}</span>
                  </div>

                  <button className="download-btn" onClick={download}><Download size={17}/> DOWNLOAD WAV REMIX</button>
                </div>
              )}
            </section>

            <aside className="control-panel">
              <div className="control-head"><div><Settings2 size={18}/><strong>ENGINE CONTROLS</strong></div><span>LIVE SETTINGS</span></div>
              <div className="control-block"><h3>BEAT CONFIGURATION</h3>
                <div className="double-field"><label>SOURCE BPM<input type="number" min="50" max="240" value={config.sourceBpm} onChange={e => update({ sourceBpm: Number(e.target.value) })}/></label>
                  <label>TARGET BPM<input type="number" min="60" max="210" value={config.bpm} onChange={e => update({ bpm: Number(e.target.value) })}/></label></div>
                <p className="field-hint">Source BPM is an estimate. Correct it if the drums drift. Changing tempo also changes the original song's pitch in v0.1.</p>
                <label className="select-label">BASS ROOT NOTE<select value={config.key} onChange={e => update({ key: e.target.value })}>
                  {Object.keys(TONICS).map(key => <option key={key} value={key}>{key}</option>)}
                </select></label>
                <KnobSlider label="BEAT START OFFSET" value={Math.round(config.beatOffset * 1000)} min={0} max={750} suffix=" ms" onChange={v => update({ beatOffset: v / 1000 })} hint="Shift generated drums to the first downbeat."/>
              </div>
              <div className="control-block"><h3>SOUND CHARACTER</h3>
                <KnobSlider label="AGGRESSION" value={config.aggression} onChange={v => update({ aggression: v })} hint="Attack and saturation of the drum kit."/>
                <KnobSlider label="808 BASS WEIGHT" value={config.bass} onChange={v => update({ bass: v })} hint="Tuned synthesized sub-bass level."/>
              </div>
              <div className="control-block"><h3>LAYERS & EFFECTS</h3>
                <Switch label="Memphis cowbell" detail="Metallic lead sequence" checked={config.cowbell} onChange={v => update({ cowbell: v })}/>
                <Switch label="Drop impacts" detail="Build-up / every 8 bars" checked={config.effects} onChange={v => update({ effects: v })}/>
                <Switch label="Keep original track" detail="Blend with source recording" checked={config.keepOriginal} onChange={v => update({ keepOriginal: v })}/>
              </div>
              <div className="control-info"><Volume2 size={18}/><div><strong>Protect your ears.</strong><p>Heavy bass is fun until it becomes a permanent ringing sound. Monitor at a sensible level.</p></div></div>
            </aside>
          </div>
        )}

        {tab === 'library' && <div className="single-page">
          <div className="eyebrow"><span className="eyebrow-mark"/> SYNTHESIZED FROM SCRATCH</div>
          <h1 className="subpage-title">SOUND <em>ARSENAL</em><span className="red-period">.</span></h1>
          <p className="subpage-intro">{SOUND_LIBRARY.length} unique synthesized variations across seven instrument families. Original sounds with different envelopes, tuning, distortion and timbre. No external downloads.</p>
          <div className="library-stats"><span>{SOUND_LIBRARY.length} <small>BUILT-IN SOUNDS</small></span><span>07 <small>INSTRUMENT FAMILIES</small></span><span>04 <small>GENRE ARRANGEMENTS</small></span></div>
          {GROUPS.map(category => <section key={category} className="library-group"><div className="section-head"><div><span className="step"><AudioLines size={13}/></span><strong>{category}</strong></div><span className="muted-label">{SOUND_LIBRARY.filter(s => s.category === category).length} SOUNDS</span></div>
            <div className="sound-list">{SOUND_LIBRARY.filter(s => s.category === category).map(sound =>
              <div className="sound-item" key={sound.id}><span className="sound-icon"><AudioWaveform size={20}/></span>
                <div><strong>{sound.name}</strong><small>{sound.detail}</small></div>
                <button className="preview-btn" onClick={() => audition(sound.id)} disabled={Boolean(previewing)}>{previewing === sound.id ? <Activity size={16}/> : <Play size={16}/>} PREVIEW</button>
              </div>)}</div>
          </section>)}
        </div>}

        {tab === 'about' && <div className="single-page">
          <div className="eyebrow"><span className="eyebrow-mark"/> MANUAL / V0.1</div>
          <h1 className="subpage-title">LOUDER BY <em>DESIGN</em><span className="red-period">.</span></h1>
          <p className="subpage-intro">PhonkForge is an offline remix maker with 42 procedural sounds and an editable 16-step manual sequencer. It is not a full DAW.</p>
          <div className="help-grid">
            {[
              ['01', 'IMPORT MUSIC', 'Bring your MP3 or WAV. The decoder reads it locally, and the BPM detector suggests a starting tempo.'],
              ['02', 'PICK A PRESET', 'Choose Drift, Brazilian, Memphis, or Atmospheric. Every preset supplies a different beat, 808 rhythm, and cowbell sequence.'],
              ['03', 'CORRECT THE GRID', 'Set source BPM accurately and adjust the beat start offset so generated hits land with the first downbeat.'],
              ['04', 'RENDER & EXPORT', 'Switch to Live Timeline, play and seek the song while adding samples at exact seconds. Export to WAV when ready.']
            ].map(([num, title, description]) => <div className="help-card" key={num}><span>{num}</span><h3>{title}</h3><p>{description}</p></div>)}
          </div>
          <div className="limitations"><Sparkles size={21}/><div><strong>KNOWN LIMITATIONS</strong><p>Live Timeline synchronizes synthesized hits with the source audio, but there is no stem separation, pitch-preserving time stretching, MP3 export or full mastering yet. Source audio pitch changes when BPM changes. This MVP intentionally avoids pretending otherwise.</p></div></div>
        </div>}
        {error && <div className="toast" role="alert"><CircleHelp size={16}/>{error}<button aria-label="Close error" onClick={() => setError('')}>×</button></div>}
      </main>
    </div>
  );
}
