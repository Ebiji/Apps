// マスタリング・チェーン。ライブ再生(AudioContext)と書き出し(OfflineAudioContext)で同一のグラフを使う。
//
// input → ローカット → EQ(低/量感/中/抜け/高/空気)
//       → [原音 + 低音エンハンサー + 高域エキサイター + サチュレーション] 並列加算
//       → M/S ステレオ幅 → コンプ → メイクアップ → リミッター → ピーククリップ安全装置 → output

import { bufferLoudness } from './loudness.js';

const dbToLin = db => Math.pow(10, db / 20);

function satCurve(drive, bias = 0, n = 4097) {
  const c = new Float32Array(n), norm = Math.tanh(drive * (1 + bias)) || 1;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (Math.tanh(drive * (x + bias)) - Math.tanh(drive * bias)) / norm;
  }
  return c;
}

function clipCurve(limit, n = 4097) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.max(-limit, Math.min(limit, x));
  }
  return c;
}

export function createChain(ctx) {
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const bq = (type, f, q = 0.707, g = 0) => {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b;
  };
  const shaper = (curve) => { const s = ctx.createWaveShaper(); s.curve = curve; s.oversample = '4x'; return s; };

  // 入力はモノラルでも必ずステレオに揃える
  const input = gain(1);
  input.channelCount = 2; input.channelCountMode = 'explicit'; input.channelInterpretation = 'speakers';

  // --- EQ ---
  const hp = bq('highpass', 25, 0.707);
  const bass = bq('lowshelf', 110);
  const lowmid = bq('peaking', 300, 0.9);
  const mid = bq('peaking', 1200, 0.8);
  const presence = bq('peaking', 3500, 1.0);
  const treble = bq('highshelf', 8000);
  const air = bq('highshelf', 14000);
  input.connect(hp); hp.connect(bass); bass.connect(lowmid); lowmid.connect(mid);
  mid.connect(presence); presence.connect(treble); treble.connect(air);

  // --- 並列エンハンサー ---
  const sum = gain(1);
  air.connect(sum);

  const bLp = bq('lowpass', 150, 0.707), bSh = shaper(satCurve(4, 0.12)), bHp = bq('highpass', 90, 0.707), bG = gain(0);
  air.connect(bLp); bLp.connect(bSh); bSh.connect(bHp); bHp.connect(bG); bG.connect(sum);

  const xHp = bq('highpass', 3500, 0.707), xSh = shaper(satCurve(3, 0.2)), xHp2 = bq('highpass', 5000, 0.707), xG = gain(0);
  air.connect(xHp); xHp.connect(xSh); xSh.connect(xHp2); xHp2.connect(xG); xG.connect(sum);

  const wSh = shaper(satCurve(1.8, 0.1)), wG = gain(0), wDc = bq('highpass', 20, 0.707);
  air.connect(wSh); wSh.connect(wDc); wDc.connect(wG); wG.connect(sum);

  // --- M/S ステレオ幅 ---
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const mBus = gain(1), sSum = gain(1), sPos = gain(1), sNeg = gain(-1);
  const mL = gain(0.5), mR = gain(0.5), sL = gain(0.5), sR = gain(-0.5);
  sum.connect(split);
  split.connect(mL, 0); split.connect(mR, 1); split.connect(sL, 0); split.connect(sR, 1);
  mL.connect(mBus); mR.connect(mBus); sL.connect(sSum); sR.connect(sSum);
  sSum.connect(sPos); sSum.connect(sNeg);
  mBus.connect(merge, 0, 0); sPos.connect(merge, 0, 0);
  mBus.connect(merge, 0, 1); sNeg.connect(merge, 0, 1);

  // --- ダイナミクス ---
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 12; comp.attack.value = 0.015; comp.release.value = 0.25;
  const makeup = gain(1);
  const lim = ctx.createDynamicsCompressor();
  lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
  // 安全装置: 4倍(+12dB)までのレンジを確保するため 1/4 → クリップ → ×4
  const safeIn = gain(0.25), safe = shaper(clipCurve(1)), safeOut = gain(4);
  const output = gain(1);
  merge.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(safeIn);
  safeIn.connect(safe); safe.connect(safeOut); safeOut.connect(output);

  let lastClip = null;

  function apply(p, { makeupDb = 0, limiter = true, immediate = false } = {}) {
    const set = (ap, v) => immediate ? (ap.value = v) : ap.setTargetAtTime(v, ctx.currentTime, 0.03);
    set(hp.frequency, p.hp);
    set(bass.gain, p.bass); set(lowmid.gain, p.lowmid); set(mid.gain, p.mid);
    set(presence.gain, p.presence); set(treble.gain, p.treble); set(air.gain, p.air);
    set(bG.gain, p.bassEnh * 0.6);
    set(xG.gain, p.exciter * 0.5);
    set(wG.gain, p.warmth * 0.45);
    set(sPos.gain, p.width); set(sNeg.gain, -p.width);
    set(comp.threshold, p.comp > 0.01 ? -8 - 16 * p.comp : 0);
    set(comp.ratio, 1 + 5 * p.comp);
    set(makeup.gain, dbToLin(makeupDb));
    set(lim.threshold, limiter ? p.ceiling - 0.5 : 0);
    set(lim.ratio, limiter ? 20 : 1);
    // safeIn で 1/4 にしているので、実際のクリップ位置もその分縮める。測定時(limiter無し)は 1.0 = 原信号の4倍まで素通し。
    const clip = limiter ? dbToLin(p.ceiling) * 0.25 : 1;
    if (clip !== lastClip) { safe.curve = clipCurve(clip); lastClip = clip; }
  }

  return { input, output, apply };
}

/** 全体を処理して AudioBuffer を返す。 */
export async function renderChain(buffer, params, opts) {
  const off = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource(); src.buffer = buffer;
  const chain = createChain(off);
  chain.apply(params, { ...opts, immediate: true });
  src.connect(chain.input); chain.output.connect(off.destination);
  src.start();
  return off.startRendering();
}

function excerpt(buffer, seconds) {
  const n = Math.min(buffer.length, Math.round(seconds * buffer.sampleRate));
  if (n >= buffer.length) return buffer;
  const start = Math.floor((buffer.length - n) / 2);
  const out = new AudioBuffer({ length: n, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(start, start + n), c);
  return out;
}

/**
 * 目標ラウドネスに合わせるメイクアップゲイン(dB)を求める。
 * 1) リミッター無しで測定して概算 2) リミッター込みで再測定して補正 (最大2回)
 */
export async function computeAutoGain(buffer, params, { maxSeconds = Infinity } = {}) {
  const src = excerpt(buffer, maxSeconds);
  const lufs0 = bufferLoudness(await renderChain(src, params, { makeupDb: 0, limiter: false }));
  if (!isFinite(lufs0)) return { gainDb: 0, lufs: -Infinity };
  let g = Math.max(-24, Math.min(36, params.loudness - lufs0));
  let lufs = lufs0 + g;
  for (let i = 0; i < 2; i++) {
    lufs = bufferLoudness(await renderChain(src, params, { makeupDb: g, limiter: true }));
    const err = params.loudness - lufs;
    if (!isFinite(lufs) || Math.abs(err) < 0.15) break;
    g = Math.max(-24, Math.min(36, g + err));
  }
  return { gainDb: g, lufs };
}
