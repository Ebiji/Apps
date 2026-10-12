import { PARAMS, GROUPS, PRESETS, EXAMPLES, defaults } from './params.js';
import { interpret } from './nlp.js';
import { createChain, renderChain, computeAutoGain } from './chain.js';
import { bufferLoudness, samplePeakDb } from './loudness.js';
import { encodeWav } from './wav.js';

const $ = id => document.getElementById(id);
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDb = v => (isFinite(v) ? v.toFixed(1) : '−∞');

// ---------------- 状態 ----------------
let params = defaults();
let undoStack = [];
let buffer = null, fileName = 'track', origLufs = -Infinity;
let autoDb = 0, autoLufs = -Infinity;
let ctx = null, chain = null, procGain = null, origGain = null, analyser = null, src = null;
let playing = false, startedAt = 0, offset = 0, abMode = 'B';
let activePreset = null;

// ---------------- オーディオ ----------------
function ensureAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  chain = createChain(ctx);
  procGain = ctx.createGain(); origGain = ctx.createGain();
  analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.8;
  chain.output.connect(procGain); procGain.connect(analyser);
  origGain.connect(analyser); analyser.connect(ctx.destination);
  applyChain(true);
}

function makeupDb() { return params.auto ? autoDb : params.gain; }

function applyChain(immediate = false) {
  if (!ctx) return;
  chain.apply(params, { makeupDb: makeupDb(), limiter: true, immediate });
  const t = ctx.currentTime;
  const matchDb = $('match').checked && params.auto && isFinite(origLufs) ? Math.min(12, Math.max(-24, autoLufs - origLufs)) : 0;
  const origLin = Math.pow(10, matchDb / 20);
  procGain.gain.setTargetAtTime(abMode === 'B' ? 1 : 0, t, 0.015);
  origGain.gain.setTargetAtTime(abMode === 'A' ? origLin : 0, t, 0.015);
}

function position() {
  if (!buffer) return 0;
  if (!playing) return offset;
  const p = ctx.currentTime - startedAt;
  return $('loop').checked ? p % buffer.duration : Math.min(p, buffer.duration);
}

function play() {
  if (!buffer) return;
  ensureAudio();
  if (ctx.state === 'suspended') ctx.resume();
  stopSource();
  const s = ctx.createBufferSource();
  s.buffer = buffer; s.loop = $('loop').checked;
  s.connect(chain.input); s.connect(origGain);
  if (offset >= buffer.duration - 0.01) offset = 0;
  s.start(0, offset);
  startedAt = ctx.currentTime - offset;
  s.onended = () => { if (src === s && !s.loop) { playing = false; offset = 0; updateTransport(); } };
  src = s; playing = true; updateTransport();
}

function stopSource() {
  if (src) { src.onended = null; try { src.stop(); } catch {} src.disconnect(); src = null; }
}
function pause() { if (!playing) return; offset = position(); stopSource(); playing = false; updateTransport(); }
function stop() { stopSource(); playing = false; offset = 0; updateTransport(); }
function seek(frac) {
  if (!buffer) return;
  offset = Math.max(0, Math.min(0.999, frac)) * buffer.duration;
  if (playing) play(); else updateTransport();
}
function updateTransport() {
  $('play').textContent = playing ? '❚❚ 一時停止' : '▶ 再生';
  $('time').textContent = buffer ? `${fmtTime(position())} / ${fmtTime(buffer.duration)}` : '0:00 / 0:00';
}

// ---------------- 自動ラウドネス ----------------
let autoToken = 0, autoRunning = false, autoDirty = false, autoTimer = null;
function scheduleAuto() {
  if (!buffer || !params.auto) { updateStats(); return; }
  clearTimeout(autoTimer);
  $('autoStat').textContent = 'ラウドネス計算待ち…';
  autoTimer = setTimeout(runAuto, 450);
}
async function runAuto() {
  if (autoRunning) { autoDirty = true; return; }
  autoRunning = true;
  const token = ++autoToken;
  $('autoStat').textContent = 'ラウドネス計算中…';
  try {
    const r = await computeAutoGain(buffer, params, { maxSeconds: 90 });
    if (token === autoToken) { autoDb = r.gainDb; autoLufs = r.lufs; applyChain(); }
  } catch (e) { console.error(e); }
  autoRunning = false;
  if (autoDirty) { autoDirty = false; runAuto(); return; }
  updateStats();
}
function updateStats() {
  $('stOrig').textContent = buffer ? `${fmtDb(origLufs)} LUFS` : '—';
  $('stOut').textContent = buffer ? `${params.auto ? params.loudness.toFixed(1) : '手動'} ${params.auto ? 'LUFS' : ''}` : '—';
  $('autoStat').textContent = buffer && params.auto && isFinite(autoLufs)
    ? `測定: 約 ${autoLufs.toFixed(1)} LUFS ／ 自動補正 ${autoDb >= 0 ? '+' : ''}${autoDb.toFixed(1)} dB`
    : (params.auto ? '' : '手動ゲインで出力します');
}

// ---------------- パラメーター UI ----------------
const rows = {};
function buildControls() {
  const host = $('controls');
  for (const [gid, gname] of Object.entries(GROUPS)) {
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = `<h3>${gname}</h3>`;
    if (gid === 'out') {
      const a = document.createElement('label'); a.className = 'autorow';
      a.innerHTML = '<input type="checkbox" id="auto" checked> 目標ラウドネスに自動で合わせる';
      g.append(a);
      const st = document.createElement('div'); st.className = 'autostat'; st.id = 'autoStat'; g.append(st);
    }
    for (const [key, d] of Object.entries(PARAMS)) {
      if (d.group !== gid) continue;
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<label for="p_${key}">${d.label}</label><input type="range" id="p_${key}" min="${d.min}" max="${d.max}" step="${d.step}"><output></output>`;
      const input = row.querySelector('input'), out = row.querySelector('output');
      input.addEventListener('input', () => { setParam(key, parseFloat(input.value), true); });
      input.addEventListener('dblclick', () => setParam(key, d.def, true));
      rows[key] = { row, input, out };
      g.append(row);
    }
    host.append(g);
  }
  $('auto').addEventListener('change', e => { params.auto = e.target.checked; refreshUI(); applyChain(); scheduleAuto(); });
}
function fmtVal(key, v) {
  const d = PARAMS[key]; const n = d.step >= 1 ? v.toFixed(0) : d.step >= 0.1 ? v.toFixed(1) : v.toFixed(2);
  return `${v > 0 && d.unit === 'dB' ? '+' : ''}${n}${d.unit ? ' ' + d.unit : ''}`;
}
function refreshUI() {
  for (const [key, r] of Object.entries(rows)) {
    r.input.value = params[key]; r.out.textContent = fmtVal(key, params[key]);
  }
  $('auto').checked = params.auto;
  rows.loudness.row.classList.toggle('disabled', !params.auto);
  rows.gain.row.classList.toggle('disabled', params.auto);
  rows.loudness.input.disabled = !params.auto;
  rows.gain.input.disabled = params.auto;
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('on', b.dataset.id === activePreset));
  updateStats();
}
function setParam(key, v, fromUser) {
  params[key] = v;
  if (fromUser) { activePreset = null; }
  rows[key].out.textContent = fmtVal(key, v);
  if (fromUser) document.querySelectorAll('.preset').forEach(b => b.classList.remove('on'));
  applyChain(); scheduleAuto();
}
function setAll(next, { keepUndo = true } = {}) {
  if (keepUndo) { undoStack.push({ ...params }); $('nlUndo').disabled = false; }
  params = next; refreshUI(); applyChain(); scheduleAuto();
}

// ---------------- 視聴条件 / 言語指示 ----------------
function buildPresets() {
  const host = $('presets');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn preset'; b.dataset.id = id;
    b.innerHTML = `<span class="ic">${p.icon}</span>${p.name}`;
    b.addEventListener('click', () => {
      const next = { ...defaults(), auto: params.auto, ...p.params };
      activePreset = id; setAll(next); $('presetdesc').textContent = p.desc;
      refreshUI();
    });
    host.append(b);
  }
}
function buildChips() {
  for (const ex of EXAMPLES) {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'chip'; c.textContent = ex;
    c.addEventListener('click', () => { $('nl').value = ex; applyNl(); });
    $('chips').append(c);
  }
}
let logBatch = null;
function log(html, cls = '') {
  const li = document.createElement('li'); li.className = cls; li.innerHTML = html;
  if (logBatch) { logBatch.push(li); return; }
  $('nlLog').prepend(li);
  while ($('nlLog').children.length > 12) $('nlLog').lastChild.remove();
}
function flushLog() {
  const items = logBatch; logBatch = null;
  const host = $('nlLog');
  for (const li of items.reverse()) host.prepend(li);
  while (host.children.length > 14) host.lastChild.remove();
}
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function applyNl() {
  const text = $('nl').value.trim();
  if (!text) return;
  const r = interpret(text, params);
  logBatch = [];
  log(`<b>「${esc(text)}」</b>`);
  if (!r.understood) {
    log('解釈できる指示が見つかりませんでした。「低音を上げて」「こもっている」「スマホで聴く」「bass +3dB」のように指定してください。', 'err');
    flushLog(); return;
  }
  for (const n of r.notes) log(`✓ ${esc(n)}`, 'note');
  for (const c of r.changes) log(`　${esc(c.text)}`);
  flushLog();
  if (r.presetId) { activePreset = r.presetId; $('presetdesc').textContent = PRESETS[r.presetId].desc; }
  setAll(r.params);
  $('nl').value = '';
}

// ---------------- ファイル読み込み ----------------
async function loadFile(file) {
  if (!file) return;
  if (!/\.(mp3|wav)$/i.test(file.name) && !/audio\/(mpeg|wav|x-wav|wave)/.test(file.type)) {
    $('fileinfo').textContent = 'MP3 または WAV を選んでください'; return;
  }
  stop();
  $('fileinfo').textContent = '読み込み中…';
  try {
    ensureAudio();
    const arr = await file.arrayBuffer();
    buffer = await ctx.decodeAudioData(arr);
  } catch (e) {
    console.error(e); buffer = null;
    $('fileinfo').textContent = 'デコードに失敗しました（壊れたファイル、または未対応の形式）'; return;
  }
  fileName = file.name.replace(/\.[^.]+$/, '');
  origLufs = bufferLoudness(buffer);
  const pk = samplePeakDb(buffer);
  $('fileinfo').textContent = `${file.name} ・ ${fmtTime(buffer.duration)} ・ ${buffer.sampleRate / 1000}kHz ・ ${buffer.numberOfChannels === 1 ? 'モノラル' : 'ステレオ'}`;
  $('stPeak').textContent = `${fmtDb(pk)} dB`;
  for (const id of ['play', 'stop', 'export']) $(id).disabled = false;
  offset = 0; drawWaveCache(); updateTransport(); updateStats();
  autoDb = 0; autoLufs = -Infinity; scheduleAuto();
}

// ---------------- 描画 ----------------
const wave = $('wave'), spec = $('spec');
let waveImg = null;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function sizeCanvas(c) {
  const r = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight || +c.getAttribute('height');
  if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
  return [c.width, c.height];
}
function drawWaveCache() {
  const [w, h] = sizeCanvas(wave);
  waveImg = document.createElement('canvas'); waveImg.width = w; waveImg.height = h;
  const g = waveImg.getContext('2d');
  g.fillStyle = css('--wave');
  if (!buffer) return;
  const ch = [...Array(buffer.numberOfChannels)].map((_, i) => buffer.getChannelData(i));
  const per = buffer.length / w;
  for (let x = 0; x < w; x++) {
    let mx = 0;
    const a = Math.floor(x * per), b = Math.min(buffer.length, Math.floor((x + 1) * per));
    const stride = Math.max(1, Math.floor((b - a) / 64));
    for (const d of ch) for (let i = a; i < b; i += stride) { const v = Math.abs(d[i]); if (v > mx) mx = v; }
    const hh = Math.max(1, mx * h * 0.95);
    g.fillRect(x, (h - hh) / 2, 1, hh);
  }
}
function draw() {
  // 波形
  const [w, h] = sizeCanvas(wave);
  if (!waveImg || waveImg.width !== w) drawWaveCache();
  const g = wave.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (waveImg) g.drawImage(waveImg, 0, 0);
  if (buffer) {
    const px = position() / buffer.duration * w;
    g.fillStyle = css('--wave-played'); g.globalAlpha = 0.35; g.fillRect(0, 0, px, h); g.globalAlpha = 1;
    g.fillRect(px - 1, 0, 2, h);
    $('time').textContent = `${fmtTime(position())} / ${fmtTime(buffer.duration)}`;
  }
  // スペクトラム
  const [sw, sh] = sizeCanvas(spec);
  const s = spec.getContext('2d'); s.clearRect(0, 0, sw, sh);
  if (analyser) {
    const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
    const nyq = ctx.sampleRate / 2, lo = Math.log10(20), hi = Math.log10(20000);
    s.beginPath(); s.moveTo(0, sh);
    for (let x = 0; x < sw; x += 2) {
      const f = Math.pow(10, lo + (x / sw) * (hi - lo));
      const i = Math.min(bins.length - 1, Math.round(f / nyq * bins.length));
      const y = sh - Math.max(0, Math.min(1, (bins[i] + 100) / 80)) * sh;
      s.lineTo(x, y);
    }
    s.lineTo(sw, sh); s.closePath();
    s.fillStyle = css('--accent'); s.globalAlpha = 0.55; s.fill(); s.globalAlpha = 1;
    s.fillStyle = css('--muted'); s.font = `${11 * (devicePixelRatio || 1)}px sans-serif`;
    for (const f of [100, 1000, 10000]) {
      const x = (Math.log10(f) - lo) / (hi - lo) * sw;
      s.fillRect(x, 0, 1, sh); s.fillText(f >= 1000 ? `${f / 1000}k` : f, x + 3, sh - 4);
    }
    // ピークメーター
    const td = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(td);
    let m = 0; for (let i = 0; i < td.length; i++) { const a = Math.abs(td[i]); if (a > m) m = a; }
    const db = m > 0 ? 20 * Math.log10(m) : -Infinity;
    if (playing) { $('stPeak').textContent = `${fmtDb(db)} dB`; $('stPeak').classList.toggle('hot', db > -0.5); }
  }
  requestAnimationFrame(draw);
}

// ---------------- 書き出し ----------------
async function loadLame() {
  if (window.lamejs) return window.lamejs;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js';
    s.onload = res; s.onerror = () => rej(new Error('MP3エンコーダの読み込みに失敗しました（ネットワークをご確認ください）'));
    document.head.append(s);
  });
  return window.lamejs;
}
function encodeMp3(lamejs, left, right, sr, kbps) {
  const enc = new lamejs.Mp3Encoder(2, sr, kbps), out = [];
  const to16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const x = Math.max(-1, Math.min(1, f[i])); o[i] = x < 0 ? x * 32768 : x * 32767; } return o; };
  const l = to16(left), r = to16(right);
  for (let i = 0; i < l.length; i += 1152) {
    const b = enc.encodeBuffer(l.subarray(i, i + 1152), r.subarray(i, i + 1152));
    if (b.length) out.push(new Uint8Array(b));
  }
  const e = enc.flush(); if (e.length) out.push(new Uint8Array(e));
  return new Blob(out, { type: 'audio/mpeg' });
}
async function exportFile() {
  if (!buffer) return;
  const btn = $('export'), st = $('exportStatus'), fmt = $('fmt').value;
  btn.disabled = true;
  try {
    let g = params.gain;
    if (params.auto) { st.textContent = 'ラウドネスを測定中…'; g = (await computeAutoGain(buffer, params)).gainDb; }
    st.textContent = 'マスタリング処理中…';
    const out = await renderChain(buffer, params, { makeupDb: g, limiter: true });
    const ch = [out.getChannelData(0), out.getChannelData(1)];
    const lufs = bufferLoudness(out), peak = samplePeakDb(out);
    let blob, ext;
    if (fmt.startsWith('mp3')) {
      st.textContent = 'MP3にエンコード中…';
      const lame = await loadLame();
      blob = encodeMp3(lame, ch[0], ch[1], out.sampleRate, +fmt.split('-')[1]); ext = 'mp3';
    } else {
      blob = encodeWav(ch, out.sampleRate, fmt === 'wav24' ? 24 : 16); ext = 'wav';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fileName}_mastered.${ext}`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    st.textContent = `完了: ${fmtDb(lufs)} LUFS ／ ピーク ${fmtDb(peak)} dB`;
  } catch (e) {
    console.error(e); st.textContent = `失敗: ${e.message}`;
  }
  btn.disabled = false;
}

// ---------------- 配線 ----------------
function setAB(mode) {
  abMode = mode;
  $('abA').classList.toggle('on', mode === 'A'); $('abB').classList.toggle('on', mode === 'B');
  applyChain();
}
buildControls(); buildPresets(); buildChips(); refreshUI();
$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => loadFile(e.target.files[0]));
const dz = $('drop');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); loadFile(e.dataTransfer.files[0]); });
$('play').addEventListener('click', () => (playing ? pause() : play()));
$('stop').addEventListener('click', stop);
$('loop').addEventListener('change', () => { if (src) src.loop = $('loop').checked; });
wave.addEventListener('click', e => seek((e.clientX - wave.getBoundingClientRect().left) / wave.clientWidth));
$('abA').addEventListener('click', () => setAB('A')); $('abB').addEventListener('click', () => setAB('B'));
$('match').addEventListener('change', () => applyChain());
$('nlApply').addEventListener('click', applyNl);
$('nl').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && (e.ctrlKey || e.metaKey || !e.shiftKey)) { e.preventDefault(); applyNl(); } });
$('nlUndo').addEventListener('click', () => {
  const prev = undoStack.pop(); if (!prev) return;
  setAll(prev, { keepUndo: false }); $('nlUndo').disabled = undoStack.length === 0; log('↩ 元に戻しました', 'note');
});
$('reset').addEventListener('click', () => { activePreset = null; $('presetdesc').textContent = ''; setAll({ ...defaults(), auto: params.auto }); });
$('export').addEventListener('click', exportFile);
addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); if (buffer) (playing ? pause() : play()); }
});
requestAnimationFrame(draw);

// テスト・デバッグ用
window.__studio = { loadFile, get params() { return params; }, applyNl };
