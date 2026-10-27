# PHONKFORGE

**Turn any track into a heavy phonk remix.** A desktop-first, offline phonk remix studio with its own synthesized instruments and original beat patterns.

> **Status: working MVP source code, not a released installer.** The optimized PCM renderer mixes full-length source audio with original synthetic drum/bass/cowbell layers (maximum 15 minutes). No AI stem splitting, independent time stretching, automatic key detection, or MP3 output yet.

## Features

- Import MP3, WAV, OGG, M4A, AAC, or FLAC when supported by Chromium's decoder (WAV and MP3 are best supported).
- Local BPM suggestion using onset autocorrelation. Edit source BPM manually to correct inaccurate estimates.
- Four independent groove templates: **Drift Fury**, **Brazilian Heat**, **Memphis Shadow**, **Dark Pulse**.
- **42 built-in synthesized sounds**, six independently tuned/timbre-shaped variations per seven families: kick, snare, closed hat, open hat, 808, cowbell, FX.
- Auto arrangements with intro, fills and breaks, **plus Manual Remix with editable 16-step patterns**.
- Select instrument variants, toggle every sequencer step, edit bass/cowbell pitches and 808 lengths, mute tracks, and mix track levels.
- Four-bar loop audition, JSON pattern import/export, and local autosave of manual beat settings.
- Manual Pattern Maker can generate standalone original beats (8, 16, 32 or 64 bars) without importing a recording.
- **Live Timeline mode:** simultaneous original-song playback + synthetic sound mixing, seek/scrub to an exact second, zoomable source waveform, drag hits to reposition, per-track sample selection, one-click `+ AT PLAYHEAD` with immediate audition, optional 1/16-step snapping, hit inspector for accurate seconds/pitch/duration/volume, and save/load timeline JSON.
- Offline WAV export of **exact absolute timeline timestamps** uses the same synthesis engine as live preview.
- Adjustable aggression, 808 weight, tonic/root note, drum-grid offset and layer switches.
- Chunked offline PCM rendering with reusable synthesized one-shots, accurate progress/cancel, playable preview, and 16-bit PCM WAV export.
- No server, API keys, or copyrighted sample packs.
- Long renders show real PCM progress and support cancellation. Maximum output length is 15 minutes (no silent trim).

## Requirements

- Node.js 22+ with npm.
- Windows 10/11 x64 for Windows packaging.
- Headphones or speakers (start at low volume).

## Development

~~~sh
git clone https://github.com/allifiz/phonk-maker.git
cd phonk-maker
npm install
npm run desktop:dev
~~~

For UI-only browser development: ~~~sh
npm run dev
~~~

The audio-processing functionality also works in a modern browser.

## Build a Windows .exe

On Windows PowerShell:

~~~powershell
npm install
npm test
npm run dist:win
~~~

The NSIS Windows installer will be under \`release/\`. For a single portable .exe instead:

~~~powershell
npm run dist:portable
~~~

The installer is **not code signed**. Windows may warn about unknown publishers. Never bypass warnings for a binary from an untrusted source.

## Live Timeline workflow

1. Import your song under **SOURCE AUDIO**, then select **LIVE TIMELINE** in **REMIX WORKFLOW**.
2. Press **Play** to listen to your original song. Drag the main song seek bar or click the waveform/time ruler to jump anywhere.
3. Each instrument has six sound choices. Choose a sound from its dropdown.
4. Press **+ AT PLAYHEAD** while listening to insert a hit immediately and hear it in context. Click empty lane space to add a hit at the clicked second. Drag a hit to move it to another time or track.
5. Select a hit to edit its precise position in seconds, sound, semitone offset, length, or level.
6. Turn **SNAP TO 1/16** on for beat-quantized placement; turn it off for free placement. Zoom the timeline to inspect details. Mute a track to compare the mix.
7. **SAVE PROJECT** downloads your event layout (not the copyrighted source recording) as JSON. **LOAD PROJECT** restores it. Events are also kept in local app storage as a convenience.
8. **GENERATE PHONK REMIX** produces WAV using the same absolute hit timestamps as realtime playback.

**Timing:** Live Timeline coordinates are seconds *after* target/source BPM playback-rate adjustment. If you change either BPM after placing clips, re-check their positions. There is no pitch-preserving time stretch or automatic detection of where the downbeat starts, so correct the source BPM manually. Live previews run at AudioContext playback speed with a short lookahead scheduler and can exhibit minor jitter under extreme CPU load. Full multitrack DAW operations (split/trim/stretch audio clips, envelope automation, native VST) are not in this release.

## Workflow

1. Optionally import an audio file. Manual mode supports beat-only creation.
2. Choose a groove preset and select Auto or Manual Remix.
3. Confirm source BPM, set target BPM, and set the 808 root note.
4. Adjust beat start offset to align the synthesized kick with the source's first downbeat.
5. In Manual mode, click the 16-step grid, choose an instrument for each row, change pitch and per-track volume, then audition the beat. Optionally export the pattern to JSON and re-import it later.
6. Adjust aggression and bass, then generate.
7. Listen and export WAV.

**Important:** The MVP changes the original track's pitch when adjusting tempo, because it uses playback-rate adjustment rather than independent time stretching. Bass root note is user-specified (there is no key detection). Heavily compressed tracks can produce imperfect mixes. This is a fast creative prototype, not a replacement for a DAW or mastering engineer.

### Internal modules

- \`src/audio/presets.js\`: original 16-step patterns and built-in sound catalog.
- \`src/audio/bpm.js\`: fast heuristic BPM estimation.
- \`src/audio/engine.js\`: real Web Audio synthesis, source mixing, sequencing, compressor and offline rendering.
- \`src/audio/wav.js\`: 16-bit PCM WAV encoder.
- \`src/App.jsx\`: music import, mixer UI, sound library and playback.
- \`electron/main.cjs\`: secure desktop window shell.

### Tests

~~~sh
npm test
npm run build
~~~

Rendering depends on Chromium's OfflineAudioContext; the Node unit tests cover data structures and WAV encoding, not integration/audio quality. Test manually with WAV/MP3 recordings on Windows before distributing.

## Intellectual property & safety

All built-in sounds are synthesized at render time and patterns are original to this project. User-imported recordings are **not** bundled into the application; only remix audio downloaded by the user is generated. Ensure you have remixing/distribution rights before releasing a remix. Listening at extreme volumes can damage hearing.

## Roadmap

- [ ] More flexible timeline, patterns, and drum sequencing.
- [ ] Optional stem separation (local model, opt-in download).
- [ ] Independent pitch/tempo stretch (licensed dependency).
- [ ] Harmonic detection, limiter/loudness tools, MP3 export.
- [ ] Optional original royalty-cleared soundpack expansion.

Licensed under MIT for the application code.


## Precision editor and live sound design

- Select a timeline hit and press **Delete** / **Backspace** to remove it. **Left** / **Right** arrow nudges its position by **0.01s**; add **Shift** for **0.1s** nudges. Shortcuts do not override inputs, dropdowns or editable fields.
- The **ADD SOUND NOW** control places the selected instrument directly at the current playback position and triggers it immediately. Lane-specific **+ AT PLAYHEAD** buttons remain.
- Preview instruments with the headphones icon beside each track, or in the hit inspector. The selected hit has a small preview waveform, and **SOURCE ONLY** suppresses generated hits during playback to let you compare the original track.
- Adjust **DURATION (SECONDS)** for every sample, from 0.05 to 6 seconds. The sample is interpolated *once* with an envelope; it is **never repeatedly looped**.
- Increasing a hit duration beyond 140% of its original default automatically turns on **RISE** and **35% ECHO** unless already customized. You can switch them off or change them afterward.
- Each hit has **PITCH FX** (\`NORMAL\`, \`RISE\`, \`DROP\`), semitone sweep intensity, and **ECHO TAIL**. Echo is a finite series of decaying delay taps, not repeated beats. All are included in live preview and WAV export through the same synthesis module.
- **ORIGINAL SONG EFFECTS** adjust source pitch, low-to-high tone, low cut and source level. Global source pitch uses playback-rate adjustment, and therefore **also changes the source speed and the timeline/output duration**. This is **not independent time stretching**.
- Rendering stores these hit settings and uses absolute output-second positioning. Project JSON includes hit duration and effects. Existing timeline JSON without FX fields remains importable.

### Known preview limitations

- Under heavy CPU load, live scheduling can have minor glitches and tempo adjustment changes source pitch.
- Offline export uses efficient one-pole filters while the live transport uses Web Audio biquads, so source EQ tone may not match perfectly at all settings.
- Pitch bend is relative to each sound's duration-warped original and does not perform pitch-preserving professional time stretching.
- Source-level FX currently apply globally, not as per-region automation. Full audio-clip lane automation is a later milestone.
