// Encode normalized or compressed Web Audio buffers into a standard 16-bit PCM WAV.
export function audioBufferToWav(buffer) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const ab = new ArrayBuffer(44 + samples * channels * 2);
  const view = new DataView(ab);
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples * channels * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples * channels * 2, true);
  const planes = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  let position = 44;
  for (let i = 0; i < samples; i++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, planes[channel][i] || 0));
      view.setInt16(position, sample < 0 ? sample * 32768 : sample * 32767, true);
      position += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
