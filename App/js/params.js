// パラメータ定義と「視聴条件」プリセット。DOM に依存しないので Node でもテストできる。

export const PARAMS = {
  hp:       { label: 'ローカット',            min: 20,  max: 150, step: 1,    unit: 'Hz',   def: 25,  nlp: 15,  group: 'eq' },
  bass:     { label: '低音 (110Hz〜)',        min: -12, max: 12,  step: 0.1,  unit: 'dB',   def: 0,   nlp: 3,   group: 'eq' },
  lowmid:   { label: '量感・こもり (300Hz)',  min: -8,  max: 8,   step: 0.1,  unit: 'dB',   def: 0,   nlp: 2,   group: 'eq' },
  mid:      { label: '中音 (1.2kHz)',         min: -8,  max: 8,   step: 0.1,  unit: 'dB',   def: 0,   nlp: 2,   group: 'eq' },
  presence: { label: 'ボーカル・抜け (3.5kHz)', min: -8, max: 8,   step: 0.1,  unit: 'dB',   def: 0,   nlp: 2,   group: 'eq' },
  treble:   { label: '高音 (8kHz〜)',         min: -12, max: 12,  step: 0.1,  unit: 'dB',   def: 0,   nlp: 3,   group: 'eq' },
  air:      { label: '空気感 (14kHz〜)',      min: -8,  max: 8,   step: 0.1,  unit: 'dB',   def: 0,   nlp: 2,   group: 'eq' },

  bassEnh:  { label: '低音エンハンサー',      min: 0, max: 1, step: 0.01, unit: '',  def: 0,   nlp: 0.25, group: 'enh' },
  exciter:  { label: '高域エキサイター',      min: 0, max: 1, step: 0.01, unit: '',  def: 0,   nlp: 0.25, group: 'enh' },
  warmth:   { label: 'ウォーム・サチュレーション', min: 0, max: 1, step: 0.01, unit: '', def: 0, nlp: 0.25, group: 'enh' },

  width:    { label: 'ステレオ幅',            min: 0, max: 2, step: 0.01, unit: '×', def: 1,   nlp: 0.2,  group: 'dyn' },
  comp:     { label: 'コンプ（音のまとまり）', min: 0, max: 1, step: 0.01, unit: '',  def: 0.3, nlp: 0.2,  group: 'dyn' },

  loudness: { label: '目標ラウドネス',        min: -24, max: -6,  step: 0.5,  unit: 'LUFS', def: -14, nlp: 2,   group: 'out' },
  ceiling:  { label: 'ピーク上限',            min: -3,  max: -0.1, step: 0.1, unit: 'dBTP', def: -1,  nlp: 0.5, group: 'out' },
  gain:     { label: '出力ゲイン（手動）',    min: -12, max: 12,  step: 0.1,  unit: 'dB',   def: 0,   nlp: 2,   group: 'out' },
};

export const GROUPS = {
  eq: 'イコライザー',
  enh: 'エンハンサー',
  dyn: 'ダイナミクス / ステレオ',
  out: '出力',
};

export function defaults() {
  const p = { auto: true };
  for (const [k, d] of Object.entries(PARAMS)) p[k] = d.def;
  return p;
}

export function clampParam(key, v) {
  const d = PARAMS[key];
  return Math.min(d.max, Math.max(d.min, v));
}

// 視聴条件ごとの最適化。「その環境で足りなくなる/出過ぎる帯域」を補う設計。
export const PRESETS = {
  headphones: {
    name: 'ヘッドホン', icon: '🎧',
    desc: 'ほぼフラット。低音をわずかに補い、長時間聴いても疲れないよう高域を少し抑える。',
    params: { bass: 1, treble: -1, air: 1, width: 1.05, comp: 0.25, loudness: -14 },
  },
  earbuds: {
    name: 'イヤホン', icon: '🎵',
    desc: '低域の量感を補い、耳に刺さりやすい3〜4kHzを少し抑える。',
    params: { hp: 28, bass: 2, lowmid: -1, presence: -1, treble: 0.5, bassEnh: 0.15, width: 1.05, comp: 0.35, loudness: -14 },
  },
  phone: {
    name: 'スマホのスピーカー', icon: '📱',
    desc: '再生できない超低域をカットし、倍音で低音を“聴かせる”。中高域を持ち上げ、モノラル寄りに。',
    params: { hp: 120, bass: -3, lowmid: 1, mid: 1.5, presence: 2, treble: 1, bassEnh: 0.8, exciter: 0.2, width: 0.7, comp: 0.6, loudness: -11 },
  },
  laptop: {
    name: 'ノートPC', icon: '💻',
    desc: '小型スピーカー向け。低域は倍音補完、ボーカル帯域を明瞭に。',
    params: { hp: 90, bass: -2, lowmid: 0.5, mid: 1, presence: 1.5, treble: 1, bassEnh: 0.6, exciter: 0.15, width: 0.85, comp: 0.5, loudness: -12 },
  },
  bt: {
    name: 'Bluetoothスピーカー', icon: '🔈',
    desc: '小型でもドンと鳴るよう低音を補強。コンプ強めでまとまり重視。',
    params: { hp: 50, bass: 1.5, lowmid: -1, presence: 1, treble: 1, bassEnh: 0.45, width: 0.9, comp: 0.55, loudness: -12 },
  },
  car: {
    name: 'カーオーディオ', icon: '🚗',
    desc: 'ロードノイズに埋もれる低域と高域を持ち上げ、こもりを抑える。',
    params: { hp: 35, bass: 2.5, lowmid: -2, mid: 0.5, presence: 1, treble: 1.5, bassEnh: 0.3, exciter: 0.1, width: 1.1, comp: 0.6, loudness: -11 },
  },
  hifi: {
    name: 'オーディオ（据え置き）', icon: '🔊',
    desc: 'ダイナミクスを残した自然な仕上げ。ほぼ補正なし、控えめなラウドネス。',
    params: { hp: 22, comp: 0.1, loudness: -16, ceiling: -1 },
  },
  night: {
    name: '夜間・小音量', icon: '🌙',
    desc: '小音量では低域・高域が聴こえにくい（等ラウドネス特性）ため両端を補強し、音量差を圧縮。',
    params: { hp: 35, bass: 3, treble: 2, air: 1, comp: 0.7, width: 0.95, loudness: -16 },
  },
  stream: {
    name: '配信・サブスク', icon: '🌐',
    desc: '-14 LUFS 基準。Spotify / YouTube などのノーマライズで音量を下げられにくい設定。',
    params: { comp: 0.3, loudness: -14, ceiling: -1 },
  },
};

export const EXAMPLES = [
  'スマホで聴くので低音をしっかり聴こえるようにして',
  '高音を少し下げて、ボーカルを前に出して',
  'こもっているので明るくして',
  '耳に刺さるのでやわらかく',
  '迫力を出して、音圧を上げて',
  'ステレオをもっと広げて',
  'warmer, bass +3dB, cut harsh highs',
  '車で聴く用に、-12LUFSで',
];
