// 曲全体の平均スペクトル（マスタリング前後の比較表示用）。

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** 戻り値: { freqs[], power[] }（20Hz〜20kHz を対数に並べた点ごとの平均パワー、1/6オクターブ幅） */
export function avgSpectrum(buf, { size = 4096, maxFrames = 120, points = 100 } = {}) {
  const sr = buf.sampleRate, chs = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  const frames = Math.max(1, Math.min(maxFrames, Math.floor(buf.length / size)));
  const hop = frames > 1 ? (buf.length - size) / (frames - 1) : 0;
  const win = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const acc = new Float64Array(size / 2);
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * hop);
    for (const d of chs) {
      for (let i = 0; i < size; i++) { re[i] = (d[start + i] || 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let k = 0; k < size / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    }
  }
  const binHz = sr / size, freqs = [], power = [];
  for (let p = 0; p < points; p++) {
    const fc = 20 * Math.pow(1000, p / (points - 1));
    const lo = Math.max(1, Math.floor(fc / Math.pow(2, 1 / 12) / binHz)), hi = Math.min(size / 2 - 1, Math.max(lo, Math.ceil(fc * Math.pow(2, 1 / 12) / binHz)));
    let s = 0; for (let k = lo; k <= hi; k++) s += acc[k];
    freqs.push(fc); power.push(s / (hi - lo + 1) / (frames * chs.length));
  }
  return { freqs, power };
}

const BANDS = [['低域 (〜150Hz)', 20, 150], ['中域 (150Hz〜2kHz)', 150, 2000], ['ボーカル帯 (2〜6kHz)', 2000, 6000], ['高域 (6kHz〜)', 6000, 20001]];

/** 全体の音量差を除いた、帯域ごとの音色変化(dB)。 */
export function toneChange(a, b) {
  const sum = (sp, lo, hi) => sp.freqs.reduce((s, f, i) => (f >= lo && f < hi ? s + sp.power[i] : s), 0) + 1e-20;
  const total = 10 * Math.log10(sum(b, 20, 20001) / sum(a, 20, 20001));
  return BANDS.map(([name, lo, hi]) => ({ name, db: 10 * Math.log10(sum(b, lo, hi) / sum(a, lo, hi)) - total }));
}
