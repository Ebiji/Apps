// WAV エンコーダ（16bit TPDFディザ / 24bit / 32bit float）。

export function encodeWav(channels, sampleRate, bits = 16) {
  const nCh = channels.length, n = channels[0].length;
  const bytes = bits / 8, dataLen = n * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bytes, true);
  v.setUint16(32, nCh * bytes, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nCh; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      if (bits === 16) {
        const d = (Math.random() - Math.random()) / 32768; // TPDF dither
        const s = Math.max(-1, Math.min(1, x + d));
        v.setInt16(o, Math.round(s < 0 ? s * 32768 : s * 32767), true);
      } else if (bits === 24) {
        const s = Math.round(x < 0 ? x * 8388608 : x * 8388607);
        v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255);
      } else {
        v.setFloat32(o, channels[c][i], true);
      }
      o += bytes;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
