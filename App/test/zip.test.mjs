import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSingle } from '../js/zip.js';
import { encodeWav } from '../js/wav.js';

test('zipSingle は標準の unzip / python zipfile で検証・解凍でき、中身が一致する（日本語名含む）', async () => {
  const wav = new Uint8Array(await encodeWav([new Float32Array(5000).map((_, i) => Math.sin(i / 7)), new Float32Array(5000)], 44100, 16).arrayBuffer());
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const f = join(dir, 'a.zip');
  writeFileSync(f, new Uint8Array(await zipSingle('テスト曲_mastered.wav', wav).arrayBuffer()));
  const py = `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;n=z.namelist();print(n[0]);import hashlib;print(hashlib.md5(z.read(n[0])).hexdigest())`;
  const out = execFileSync('python3', ['-I', '-c', py, f]).toString().trim().split('\n');
  assert.equal(out[0], 'テスト曲_mastered.wav');
  const md5 = execFileSync('python3', ['-I', '-c', 'import hashlib,sys;print(hashlib.md5(open(sys.argv[1],"rb").read()).hexdigest())', (writeFileSync(join(dir, 'w.wav'), wav), join(dir, 'w.wav'))]).toString().trim();
  assert.equal(out[1], md5);
});
