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
- Manual mode can generate standalone original beats (8, 16, 32, or 64 bars) without importing a recording.
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
