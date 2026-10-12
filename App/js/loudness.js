// ITU-R BS.1770 に準拠した K特性ラウドネス測定（ゲーティング付き）。

function shelf(fs) {
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const A = Math.pow(10, G / 40), w0 = 2 * Math.PI * f0 / fs;
  const al = Math.sin(w0) / (2 * Q), c = Math.cos(w0), sA = 2 * Math.sqrt(A) * al;
  const a0 = (A + 1) - (A - 1) * c + sA;
  return {
    b: [A * ((A + 1) + (A - 1) * c + sA) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - sA) / a0],
    a: [1, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - sA) / a0],
  };
}

function highpass(fs) {
  const f0 = 38.13547087602444, Q = 0.5003270373238773;
  const w0 = 2 * Math.PI * f0 / fs, al = Math.sin(w0) / (2 * Q), c = Math.cos(w0);
  const a0 = 1 + al;
  return {
    b: [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0],
    a: [1, -2 * c / a0, (1 - al) / a0],
  };
}

function filter(x, { b, a }) {
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const o = b[0] * v + z1;
    z1 = b[1] * v - a[1] * o + z2;
    z2 = b[2] * v - a[2] * o;
    y[i] = o;
  }
  return y;
}

const toLufs = p => -0.691 + 10 * Math.log10(p);

/** @param {Float32Array[]} channels L/R（モノラルは [ch, ch] で渡す） @returns LUFS（無音は -Infinity） */
export function integratedLoudness(channels, fs) {
  const sh = shelf(fs), hp = highpass(fs);
  const cums = channels.map(ch => {
    const k = filter(filter(ch, sh), hp);
    const c = new Float64Array(k.length + 1);
    for (let i = 0; i < k.length; i++) c[i + 1] = c[i] + k[i] * k[i];
    return c;
  });
  const n = channels[0].length;
  const blk = Math.min(Math.round(0.4 * fs), n), step = Math.max(1, Math.round(0.1 * fs));
  const powers = [];
  for (let s = 0; s + blk <= n; s += step) {
    let p = 0;
    for (const c of cums) p += (c[s + blk] - c[s]) / blk;
    powers.push(p);
  }
  const abs = powers.filter(p => p > 0 && toLufs(p) > -70);
  if (!abs.length) return -Infinity;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = toLufs(mean(abs)) - 10;
  const gated = abs.filter(p => toLufs(p) > rel);
  return gated.length ? toLufs(mean(gated)) : -Infinity;
}

/** AudioBuffer から測定。モノラルは両チャンネル再生として扱う。 */
export function bufferLoudness(buf) {
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  return integratedLoudness([l, r], buf.sampleRate);
}

export function samplePeakDb(buf) {
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  }
  return m > 0 ? 20 * Math.log10(m) : -Infinity;
}
