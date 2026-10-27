// Original procedural sounds. No external samples or copyrighted recordings.
// Every preset is rendered with different synthesis parameters, not just a new label.
export const TRACKS = [
  { id: 'kick', label: 'KICK', category: 'DRUMS', color: '#f17078' },
  { id: 'snare', label: 'SNARE', category: 'DRUMS', color: '#f8a667' },
  { id: 'hat', label: 'CLOSED HAT', category: 'DRUMS', color: '#e0c86a' },
  { id: 'openHat', label: 'OPEN HAT', category: 'DRUMS', color: '#a8d894' },
  { id: 'bass', label: '808 BASS', category: 'BASS', color: '#9d8bef' },
  { id: 'bell', label: 'COWBELL', category: 'MELODY', color: '#61b7da' },
  { id: 'impact', label: 'IMPACT', category: 'FX', color: '#e490c3' }
];
export const SOUND_VARIANTS = {
  kick: [
    ['kick', 'IRON KICK', 'Pitch sweep, hard transient'],
    ['kick-low', 'EARTHQUAKE', 'Low fundamental, long body'],
    ['kick-click', 'NEEDLE PUNCH', 'Sharp click, short punch'],
    ['kick-boom', 'WAREHOUSE', 'Thick sub kick, long tail'],
    ['kick-dry', 'DUSTY KICK', 'Dry vintage drum machine'],
    ['kick-hammer', 'STEEL HAMMER', 'Aggressive high-pitch knock']
  ],
  snare: [
    ['snare', 'GRIT SNARE', 'Snappy white-noise crack'],
    ['snare-tight', 'CUT SNARE', 'Short clipped attack'],
    ['snare-wide', 'ARENA SNARE', 'Full noise and drum body'],
    ['snare-rim', 'RIM SHOT', 'Metallic, narrow crack'],
    ['snare-lofi', 'TAPE SNARE', 'Dusty compressed texture'],
    ['snare-brutal', 'CRUSH SNARE', 'Overdriven snare snap']
  ],
  hat: [
    ['hat', 'RAZOR HAT', 'Bright short metallic fizz'],
    ['hat-soft', 'SILK HAT', 'Soft low-pass tick'],
    ['hat-16', 'TICK HAT', 'Very short, precise tick'],
    ['hat-digital', 'GLITCH HAT', 'Ring-modulated metallic hiss'],
    ['hat-dust', 'DUST HAT', 'Dry noisy lo-fi tick'],
    ['hat-bright', 'LASER HAT', 'Sharp, high-frequency transient']
  ],
  openHat: [
    ['openHat', 'AIR HAT', 'Breathy extended metallic tail'],
    ['openHat-long', 'CYBER WASH', 'Long ringing texture'],
    ['openHat-short', 'SIDE HAT', 'Short open-hat accent'],
    ['openHat-metal', 'STEEL WASH', 'Metallic resonant overtone'],
    ['openHat-dust', 'TAPE WASH', 'Muted hazy top end'],
    ['openHat-sharp', 'NEON OPEN', 'Bright cutting shimmer']
  ],
  bass: [
    ['bass', 'SUBJECT 808', 'Pure pitched 808 with overdrive'],
    ['bass-clean', 'ABYSS SUB', 'Clean smooth sub frequencies'],
    ['bass-growl', 'DEMON 808', 'Heavy harmonic growl'],
    ['bass-reese', 'REAPER REESE', 'Detuned, beating dual oscillator'],
    ['bass-short', 'PUNCH 808', 'Short punchy sub decay'],
    ['bass-grit', 'RUST 808', 'Square-like saturated sub']
  ],
  bell: [
    ['bell', 'MEMPHIS BELL', 'Dual oscillator classic cowbell'],
    ['bell-ghost', 'GHOST BELL', 'Dark hollow cowbell'],
    ['bell-metal', 'IRON BELL', 'Bright dissonant metallic ring'],
    ['bell-dry', 'DRY BELL', 'Short percussion-like bell'],
    ['bell-low', 'UNDERGROUND', 'Low-register bell drone'],
    ['bell-digital', 'DIGITAL BELL', 'Hard stepped pulse bell']
  ],
  impact: [
    ['impact', 'DROP IMPACT', 'Synthesized sub drop + sweep'],
    ['impact-deep', 'DEEP DROP', 'Extra-low cinematic impact'],
    ['impact-rise', 'RISER NOISE', 'Rising noise energy'],
    ['impact-snap', 'HIT STOP', 'Short sudden thud'],
    ['impact-metal', 'METAL CRASH', 'Harsh resonant crash'],
    ['impact-static', 'TAPE FALL', 'Lo-fi dissolving wash']
  ]
};
export const SOUND_LIBRARY = TRACKS.flatMap(track =>
  SOUND_VARIANTS[track.id].map(([id, name, detail], variant) => ({
    id, name, detail, variant, family: track.id, category: track.category
  }))
);
export const SOUND_INDEX = Object.fromEntries(SOUND_LIBRARY.map(sound => [sound.id, sound]));
export const DEFAULT_KIT = Object.fromEntries(TRACKS.map(track => [track.id, track.id]));
const KITS = {
  drift:   [5, 5, 5, 3, 2, 2, 0],
  brazil:  [2, 3, 1, 2, 4, 5, 3],
  memphis: [4, 4, 4, 4, 1, 3, 5],
  pulse:   [1, 2, 1, 1, 3, 1, 1]
};
export function kitForPreset(presetId) {
  const variations = KITS[presetId] || KITS.drift;
  return Object.fromEntries(TRACKS.map((track, index) =>
    [track.id, SOUND_VARIANTS[track.id][variations[index]][0]]
  ));
}
export function resolveSound(trackId, soundId) {
  const sound = SOUND_INDEX[soundId];
  return sound && sound.family === trackId ? sound : SOUND_INDEX[trackId];
}
