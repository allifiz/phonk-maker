// Lightweight onset-autocorrelation BPM estimate. A guide, not a DJ-grade beat grid.
export function estimateBpm(buffer) {
  const rate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const hop = 512;
  const start = Math.min(Math.floor(rate * 2), Math.floor(data.length / 8));
  const end = Math.min(data.length, start + rate * 24);
  if (end - start < rate * 3) return null;
  const flux = [];
  let previous = 0;
  for (let i = start; i + hop < end; i += hop) {
    let energy = 0;
    for (let k = i + 2; k < i + hop; k += 2) {
      energy += Math.abs(data[k] - data[k - 2]);
    }
    energy /= hop / 2;
    flux.push(Math.max(0, energy - previous));
    previous = energy;
  }
  if (flux.length < 100) return null;
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  for (let i = 0; i < flux.length; i++) {
    flux[i] = Math.max(0, flux[i] - mean * 0.6);
  }
  const squared = flux.reduce((sum, x) => sum + x * x, 0);
  if (squared < 0.000001) return null;
  let best = { bpm: 0, score: -Infinity };
  for (let bpm = 75; bpm <= 185; bpm++) {
    const lag = 60 * rate / (hop * bpm);
    let score = 0;
    for (let i = 0; i < flux.length - lag - 2; i++) {
      const target = i + lag;
      const low = Math.floor(target);
      const frac = target - low;
      const shifted = flux[low] * (1 - frac) + flux[low + 1] * frac;
      score += flux[i] * shifted;
    }
    // Center preference reduces frequent octave-speed misidentifications.
    score *= 1 - Math.abs(bpm - 125) / 800;
    if (score > best.score) best = { bpm, score };
  }
  return best.score > 0 ? best.bpm : null;
}
