import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../js/nlp.js';
import { defaults, PARAMS } from '../js/params.js';
import { integratedLoudness } from '../js/loudness.js';
import { encodeWav } from '../js/wav.js';

const run = t => interpret(t, defaults());
const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);

test('低音を上げて / 下げて', () => {
  assert.ok(run('低音を上げて').params.bass > 0);
  assert.ok(run('低音を下げて').params.bass < 0);
});
test('程度の副詞', () => {
  const a = run('低音を少し上げて').params.bass, b = run('低音をかなり上げて').params.bass;
  assert.ok(0 < a && a < b);
});
test('複数指示を別々に解釈', () => {
  const r = run('低音を上げて高音を下げて').params;
  assert.ok(r.bass > 0 && r.treble < 0);
  const e = run('boost bass and cut treble').params;
  assert.ok(e.bass > 0 && e.treble < 0);
});
test('数値dB指定', () => {
  near(run('bass +3dB').params.bass, 3);
  near(run('低音を2dB下げて').params.bass, -2);
  near(run('高音 -4db').params.treble, -4);
});
test('すぎ表現は逆方向', () => {
  assert.ok(run('低音が強すぎる').params.bass < 0);
  assert.ok(run('高音が足りない').params.treble > 0);
});
test('こもり→明瞭に / 刺さり→抑える', () => {
  const m = run('こもっている').params;
  assert.ok(m.presence > 0 && m.lowmid < 0);
  const h = run('耳に刺さる').params;
  assert.ok(h.treble < 0 && h.presence < 0);
});
test('こもりを減らして は“直す”方向のまま', () => {
  assert.ok(run('こもりを減らして').params.presence > 0);
});
test('視聴条件プリセット', () => {
  const r = run('スマホで聴く');
  assert.equal(r.presetId, 'phone');
  assert.equal(r.params.hp, 120);
  assert.equal(run('車で聴く用に').presetId, 'car');
  near(run('スマホで聴くので低音を上げて').params.bass, -3 + PARAMS.bass.nlp);
});
test('LUFS指定', () => {
  assert.equal(run('-12LUFSで').params.loudness, -12);
});
test('ステレオ幅/迫力/ボーカル前', () => {
  assert.ok(run('ステレオをもっと広げて').params.width > 1);
  assert.ok(run('ステレオを狭くして').params.width < 1);
  const p = run('迫力を出して').params;
  assert.ok(p.bass > 0 && p.comp > 0.3);
  assert.ok(run('ボーカルを前に出して').params.presence > 0);
});
test('範囲クランプ・未理解', () => {
  assert.equal(run('低音を100dB上げて').params.bass, PARAMS.bass.max);
  assert.equal(run('あいうえお').understood, false);
});
test('K特性: フルスケール1kHzステレオ正弦波 ≈ 0 LUFS', () => {
  const fs = 48000, x = new Float32Array(fs * 5);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * 1000 * i / fs);
  near(integratedLoudness([x, x], fs), 0, 0.3);
  const q = x.map(v => v * 0.1);                       // -20dB
  near(integratedLoudness([q, q], fs), -20, 0.3);
  assert.equal(integratedLoudness([new Float32Array(fs), new Float32Array(fs)], fs), -Infinity);
});
test('WAVヘッダ', async () => {
  const b = encodeWav([new Float32Array(10), new Float32Array(10)], 44100, 16);
  assert.equal(b.size, 44 + 10 * 2 * 2);
  const u = new Uint8Array(await b.arrayBuffer());
  assert.equal(String.fromCharCode(...u.slice(0, 4)), 'RIFF');
});
