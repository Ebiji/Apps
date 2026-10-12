// 言語による音調指示 → パラメータ変更。ルールベース（完全オフライン）。
// 日本語・英語のキーワード、方向（上げる/下げる）、程度（少し/かなり）、数値（+3dB, -12LUFS）を解釈する。

import { PARAMS, PRESETS, defaults, clampParam } from './params.js';

const PRESET_WORDS = [
  ['phone',      /スマホ|スマートフォン|iphone|android|携帯|phone\s*speaker/],
  ['earbuds',    /イヤホン|イヤフォン|earphone|earbud|airpods|インナーイヤー/],
  ['headphones', /ヘッドホン|ヘッドフォン|headphone/],
  ['car',        /カーオーディオ|車|クルマ|ドライブ中|\bcar\b/],
  ['laptop',     /ノートpc|ノートパソコン|パソコン|laptop|pcスピーカー/],
  ['bt',         /bluetooth|ブルートゥース|ポータブルスピーカー|携帯スピーカー/],
  ['night',      /深夜|夜間|夜に|夜は|小音量|night|late\s*night|quiet/],
  ['stream',     /配信|youtube|ユーチューブ|spotify|サブスク|streaming|apple\s*music/],
  ['hifi',       /オーディオ|hi-?fi|ハイファイ|スピーカー|ホームシアター/],
];

const UP = /上げ|あげ|増や|ふやし|強め|強く|強調|強化|足し|アップ|ブースト|持ち上げ|出して|立たせ|前に|大きく|boost|increase|raise|more|\bup\b|louder|add|\+/;
const DOWN = /下げ|さげ|減ら|へらし|弱め|弱く|抑え|おさえ|カット|削|ダウン|控えめ|絞|cut|reduce|lower|less|\bdown\b|decrease|tame|soften|[-−－]/;
const LACK = /足りない|不足|弱すぎ|薄すぎ|聴こえない|聞こえない|聴こえにく|聞こえにく|lack|too\s+(weak|thin|quiet)|not enough/;
const EXCESS = /出すぎ|強すぎ|多すぎ|効きすぎ|効き過ぎ|出過ぎ|強過ぎ|すぎ|過ぎ|too\s+(much|loud|strong|boomy|heavy)/;

const MAG = [
  [/かなり|とても|すごく|めっちゃ|大幅|ぐっと|思い切り|大きく|very|much|a\s+lot|heavily|strongly|extreme/, 2],
  [/もう少し|もうちょっと|ちょい足し/, 0.8],
  [/少し|ちょっと|やや|わずか|軽く|ほんのり|slightly|a\s+(little\s+)?bit|a\s+touch|little|subtle|\bsome\b/, 0.5],
  [/もっと|さらに|より|further/, 1.4],
];

// 方向を動詞で決める「パラメータ」型。extra は連動して動く副次パラメータ（本体の符号に従う）。
const DIRECTIONAL = [
  { re: /低音エンハンサー|ベースエンハンサー|bass\s*enhanc/,             key: 'bassEnh' },
  { re: /エキサイター|exciter/,                                          key: 'exciter' },
  { re: /重低音|サブベース|sub\s*bass|ずっしり/,                          key: 'bass', extra: { bassEnh: 0.15 } },
  { re: /低音|低域|ベース|bass|low\s*end|\blows?\b/,                      key: 'bass' },
  { re: /中低域|量感|厚み|low\s*mids?/,                                   key: 'lowmid' },
  { re: /中音|中域|ミッド|\bmids?\b|midrange/,                            key: 'mid' },
  { re: /ボーカル|ヴォーカル|歌声|歌|声|vocals?|voice|presence|抜け/,     key: 'presence' },
  { re: /高音|高域|トレブル|ハイ(?!ブリッド)|treble|\bhighs?\b|top\s*end/, key: 'treble' },
  { re: /空気感|エアー?|air\b|シマー|きらめき/,                            key: 'air', extra: { exciter: 0.08 } },
  { re: /ステレオ幅|ステレオ|広がり|音場|幅|stereo|width|space/,          key: 'width' },
  { re: /音圧|パンチ|ラウドネス|音量|loudness|volume|punch/,              key: 'loudness', extra: { comp: 0.05 } },
  { re: /ダイナミクス|ダイナミックレンジ|dynamics?/,                      key: 'comp', invert: true },
  { re: /コンプ|compress|圧縮/,                                           key: 'comp' },
  { re: /ローカット|ハイパス|low\s*cut|rumble|ゴロゴロ|ランブル/,          key: 'hp' },
  { re: /温かみ|あたたかみ|サチュレーション|saturation|analog|アナログ|テープ|tape/, key: 'warmth' },
];

// 形容詞・状態表現の「効果ベクトル」型。problem=true は「悪い状態の訴え」で、常に“直す”方向に働く。
const ADJECTIVES = [
  { re: /暗い|こもっ|こもり|こもる|曇|くぐも|muffled|muddy|boxy|dull/, problem: true,
    fx: { lowmid: -2, presence: 2, treble: 1.5, air: 0.5 }, msg: 'こもりを解消' },
  { re: /明るすぎ|キンキン|耳に痛い|刺さ|うるさい|きつい|ざらつ|歯擦|harsh|sibilan|shrill|piercing|brittle/, problem: true,
    fx: { presence: -2.5, treble: -3, exciter: -0.15 }, msg: '耳障りな高域を抑制' },
  { re: /ブーミー|boomy|もこもこ|ぼわ|ボワ|ぼやけ|濁っ|濁り/, problem: true,
    fx: { bass: -2.5, lowmid: -3 }, msg: '低域のにごりを抑制' },
  { re: /薄い|スカスカ|ペラペラ|軽い|細い|thin|weak\s*sound|tinny/, problem: true,
    fx: { bass: 2.5, lowmid: 2, warmth: 0.2 }, msg: '音の厚みを補強' },
  { re: /明るく|明るい|クリア|すっきり|透明感|bright|clear|crisp|airy/, fx: { treble: 2, presence: 1.5, air: 1, exciter: 0.15 }, msg: '明るく・クリアに' },
  { re: /暗く|ダーク|落ち着|まろやか|柔らかく|やわらか|やさしく|優しく|マイルド|dark|mellow|soft|smooth|mild/, fx: { treble: -2.5, presence: -1, air: -1, warmth: 0.15 }, msg: 'やわらかく' },
  { re: /温かく|暖かく|あったか|ウォーム|warm|太く|太い|ふくよか|ふっくら/, fx: { lowmid: 1.5, bass: 1, treble: -0.8, warmth: 0.3 }, msg: '温かみ・太さを追加' },
  { re: /迫力|パワフル|パワー|力強|ド迫力|アグレッシブ|重厚|powerful|punchy|heavy|aggressive|big/, fx: { bass: 2, lowmid: 1, comp: 0.2, loudness: 1.5, exciter: 0.1 }, msg: '迫力アップ' },
  { re: /艶|つや|きらびやか|輝き|煌|sparkle|shiny|shine|brilliance|brilliant|glossy/, fx: { exciter: 0.25, air: 1.5, treble: 1 }, msg: '艶・輝きを付加' },
  { re: /ドンシャリ|ドンシャ|scooped|v-?shaped/, fx: { bass: 3, treble: 3, mid: -2 }, msg: 'ドンシャリ' },
  { re: /広く|ワイド|広げ|ひろげ|wide|spacious|immersive|没入/, fx: { width: 0.25 }, msg: 'ステレオを広げる' },
  { re: /狭く|せまく|モノラル寄り|センター寄り|mono|narrow|focused|まとまり/, fx: { width: -0.25, comp: 0.1 }, msg: 'ステレオを絞る' },
  { re: /ボーカルを前|声を前|vocals?\s+(up\s+)?front|vocal\s+forward|歌を前/, fx: { presence: 2.5, mid: 1, lowmid: -0.5 }, msg: 'ボーカルを前へ' },
  { re: /ボーカルを引っ込|声を引っ込|控えめなボーカル|vocals?\s+back/, fx: { presence: -2.5, mid: -1 }, msg: 'ボーカルを後ろへ' },
  { re: /ダイナミック|自然な(音|仕上げ)|natural|dynamic/, fx: { comp: -0.25, loudness: -1.5 }, msg: 'ダイナミクスを残す' },
  { re: /ラジオ|lo-?fi|ローファイ|電話|telephone/, fx: { hp: 120, bass: -6, treble: -4, mid: 3, presence: 2, warmth: 0.4 }, msg: 'ローファイ質感' },
];

const fmt = (key, v) => {
  const d = PARAMS[key];
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : d.step >= 1 ? v.toFixed(0) : d.step >= 0.1 ? v.toFixed(1) : v.toFixed(2);
  return `${d.label.replace(/\s*\(.*\)/, '')} ${s}${d.unit}`;
};

function splitClauses(text) {
  return text.split(/[、，,。.；;\n]+|\s+(?:and|then|but)\s+|そして|それと|それから|あと|また|けど|けれど|でも/)
    .map(s => s.trim()).filter(Boolean);
}

function magnitudeIn(seg, fallback) {
  for (const [re, m] of MAG) if (re.test(seg)) return m;
  return fallback;
}

/** 動詞方向: +1 / -1 / 0（不明）。 */
function directionIn(seg) {
  if (LACK.test(seg)) return 1;
  if (EXCESS.test(seg)) return -1;
  // 「上げ」「下げ」が両方ある場合は最後に出たものを採用（"下げすぎたので上げて" 等）
  let best = 0, pos = -1;
  for (const [re, s] of [[UP, 1], [DOWN, -1]]) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(seg))) if (m.index >= pos) { pos = m.index; best = s; }
  }
  return best;
}

export function interpret(text, current) {
  const t = String(text || '').toLowerCase().normalize('NFKC');
  const out = { ...(current || defaults()) };
  const before = { ...out };
  const notes = [];
  const acc = {}; // key -> 変更量の合計（プリセット後に加算）
  const add = (key, delta) => { acc[key] = (acc[key] || 0) + delta; };
  let presetId = null;

  // 1. 視聴条件（プリセット）
  for (const [id, re] of PRESET_WORDS) {
    if (re.test(t)) { presetId = id; break; }
  }
  if (presetId) {
    const base = defaults();
    base.auto = out.auto;
    Object.assign(out, base, PRESETS[presetId].params);
    notes.push(`視聴条件「${PRESETS[presetId].name}」を適用`);
  }

  // 2. 絶対値指定: -12 LUFS
  const lu = t.match(/(-?\s?\d+(?:\.\d+)?)\s*lufs/);
  if (lu) {
    out.loudness = clampParam('loudness', parseFloat(lu[1].replace(/\s/g, '')));
    out.auto = true;
    notes.push(`目標ラウドネス ${out.loudness} LUFS`);
  }
  const text2 = t.replace(/(-?\s?\d+(?:\.\d+)?)\s*lufs/g, ' ');

  // 3. 節ごとに解釈
  for (const clause of splitClauses(text2)) {
    let rest = clause;
    const found = []; // {start,end,def,kind}

    // 形容詞型を先に（長い表現が優先）。マッチ部分は空白で潰して二重解釈を防ぐ。
    for (const def of ADJECTIVES) {
      const m = def.re.exec(rest);
      if (m) {
        found.push({ start: m.index, end: m.index + m[0].length, def, kind: 'adj' });
        rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
      }
    }
    for (const def of DIRECTIONAL) {
      const g = new RegExp(def.re.source, 'g');
      let m;
      while ((m = g.exec(rest))) {
        found.push({ start: m.index, end: m.index + m[0].length, def, kind: 'dir' });
        rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
        g.lastIndex = m.index + m[0].length;
      }
    }
    found.sort((a, b) => a.start - b.start);

    const clauseMag = magnitudeIn(clause, 1);
    found.forEach((f, i) => {
      const prevEnd = i > 0 ? found[i - 1].end : 0;
      const nextStart = i + 1 < found.length ? found[i + 1].start : clause.length;
      const after = clause.slice(f.end, nextStart);
      const before_ = clause.slice(prevEnd, f.start);
      // 日本語は目的語の後ろに動詞、英語は前。まず後ろ、なければ前を見る。
      const dirAfter = directionIn(after), dirBefore = directionIn(before_);
      let dir = dirAfter || dirBefore;
      const mag = magnitudeIn(after, magnitudeIn(before_, clauseMag));

      if (f.kind === 'adj') {
        const { def } = f;
        let sign = 1;
        if (!def.problem && (dir < 0 || (EXCESS.test(after) && !LACK.test(after)))) sign = -1;
        for (const [key, amt] of Object.entries(def.fx)) add(key, amt * mag * sign);
        notes.push(`${def.msg}${sign < 0 ? '（逆方向）' : ''}${mag !== 1 ? ` ×${mag}` : ''}`);
        return;
      }

      const { def } = f;
      const key = def.key, pd = PARAMS[key];
      // 数値 (+3db / 3db上げ / 3 db)
      const num = after.match(/([+\-−－＋]?)\s*(\d+(?:\.\d+)?)\s*(?:db|デシベル)/) ||
                  before_.match(/([+\-−－＋]?)\s*(\d+(?:\.\d+)?)\s*(?:db|デシベル)\s*$/);
      let delta;
      if (num && pd.unit === 'dB') {
        let sgn = /[-−－]/.test(num[1]) ? -1 : 1;
        if (!num[1] && dir) sgn = dir;
        delta = sgn * parseFloat(num[2]);
      } else {
        if (!dir) dir = 1; // 方向語がなければ「強める」とみなす
        delta = dir * pd.nlp * mag;
      }
      if (def.invert) delta = -delta;
      add(key, delta);
      if (def.extra) for (const [k2, a2] of Object.entries(def.extra)) add(k2, Math.sign(delta) * a2 * mag);
    });
  }

  for (const [key, delta] of Object.entries(acc)) {
    out[key] = clampParam(key, +(out[key] + delta).toFixed(3));
  }

  // 変更点の要約
  const changes = [];
  for (const key of Object.keys(PARAMS)) {
    if (Math.abs(out[key] - before[key]) > 1e-6) changes.push({ key, from: before[key], to: out[key], text: `${fmt(key, before[key])} → ${fmt(key, out[key])}` });
  }
  const understood = notes.length > 0 || changes.length > 0;
  return { params: out, changes, notes, presetId, understood };
}
